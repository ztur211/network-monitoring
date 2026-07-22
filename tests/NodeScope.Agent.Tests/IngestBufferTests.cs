using NodeScope.Agent;
using NodeScope.Contracts.Monitoring;
using Xunit;
using static NodeScope.Agent.Tests.TestData;

namespace NodeScope.Agent.Tests;

public class IngestBufferTests
{
    private static AgentHttpException Http(int status) =>
        new(status, status.ToString(System.Globalization.CultureInfo.InvariantCulture));

    private static IngestBatchDto Batch(string deviceId, bool ok = true) =>
        new() { Checks = [new StatusCheckDto { DeviceId = deviceId, Ok = ok }], Metrics = [] };

    [Fact]
    public async Task Persists_drains_on_success_keeps_on_failure()
    {
        var path = TempPath("queue.jsonl");
        var buffer = new IngestBuffer(path, maxItems: 10);
        buffer.Enqueue(Batch("a"));
        Assert.Equal(1, buffer.Size);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => buffer.DrainAsync(_ => throw new InvalidOperationException("offline")));
        Assert.Equal(1, buffer.Size); // kept
        Assert.Equal(1, new IngestBuffer(path, maxItems: 10).Size); // persisted across restart

        var flushes = 0;
        await buffer.DrainAsync(_ =>
        {
            flushes++;
            return Task.CompletedTask;
        });
        Assert.Equal(1, flushes);
        Assert.Equal(0, buffer.Size);
    }

    [Fact]
    public async Task Drops_oldest_beyond_the_cap_and_keeps_newest()
    {
        var buffer = new IngestBuffer(TempPath("queue.jsonl"), maxItems: 2);
        buffer.Enqueue(Batch("1"));
        buffer.Enqueue(Batch("2"));
        buffer.Enqueue(Batch("3"));
        Assert.Equal(2, buffer.Size);

        var drained = new List<string>();
        await buffer.DrainAsync(b =>
        {
            drained.Add(b.Checks![0].DeviceId);
            return Task.CompletedTask;
        });
        Assert.Equal(["2", "3"], drained); // oldest ('1') was evicted
    }

    [Fact]
    public async Task Drops_a_batch_on_a_permanent_4xx_and_continues_to_later_batches()
    {
        var buffer = new IngestBuffer(TempPath("queue.jsonl"), maxItems: 10);
        buffer.Enqueue(Batch("bad", ok: false));
        buffer.Enqueue(Batch("good"));
        Assert.Equal(2, buffer.Size);

        var drained = new List<string>();
        var calls = 0;
        await buffer.DrainAsync(b =>
        {
            calls++;
            if (calls == 1)
            {
                throw Http(404);
            }

            drained.Add(b.Checks![0].DeviceId);
            return Task.CompletedTask;
        });
        Assert.Equal(0, buffer.Size); // both processed (bad dropped, good flushed)
        Assert.Equal(["good"], drained);
    }

    [Fact]
    public async Task Keeps_the_head_batch_on_a_transient_error_and_stops_draining()
    {
        var buffer = new IngestBuffer(TempPath("queue.jsonl"), maxItems: 10);
        buffer.Enqueue(Batch("first"));
        buffer.Enqueue(Batch("second"));

        await Assert.ThrowsAsync<AgentHttpException>(() => buffer.DrainAsync(_ => throw Http(503)));
        Assert.Equal(2, buffer.Size); // head kept, drain stopped
    }

    [Fact]
    public async Task Http_429_is_transient_not_permanent()
    {
        var buffer = new IngestBuffer(TempPath("queue.jsonl"), maxItems: 10);
        buffer.Enqueue(Batch("throttled"));

        await Assert.ThrowsAsync<AgentHttpException>(() => buffer.DrainAsync(_ => throw Http(429)));
        Assert.Equal(1, buffer.Size);
    }

    // --- 413: too big is NOT permanent. This is the data-loss bug. ---------------------------

    [Fact]
    public async Task Splits_and_retries_on_413_instead_of_dropping()
    {
        var buffer = new IngestBuffer(TempPath("queue.jsonl"), maxItems: 10);
        buffer.Enqueue(new IngestBatchDto { Checks = Checks(8), Metrics = Metrics(8) });

        // A server that refuses anything over 4 items, exactly as the API's per-batch cap does.
        var delivered = new List<string>();
        await buffer.DrainAsync(b =>
        {
            if (Items(b) > 4)
            {
                throw Http(413);
            }

            delivered.AddRange((b.Checks ?? []).Select(c => $"c:{c.DeviceId}"));
            delivered.AddRange((b.Metrics ?? []).Select(m => $"m:{m.DeviceId}"));
            return Task.CompletedTask;
        });

        Assert.Equal(0, buffer.Size);
        Assert.Equal(16, delivered.Count); // NOTHING was dropped
        Assert.Equal(16, delivered.Distinct().Count()); // and nothing was duplicated
    }

    [Fact]
    public async Task Drops_only_the_unsplittable_single_item_on_413()
    {
        var buffer = new IngestBuffer(TempPath("queue.jsonl"), maxItems: 10);
        buffer.Enqueue(Batch("poison"));
        buffer.Enqueue(Batch("good"));

        var delivered = new List<string>();
        var calls = 0;
        await buffer.DrainAsync(b =>
        {
            if (++calls == 1)
            {
                throw Http(413); // even a single item is refused
            }

            delivered.Add(b.Checks![0].DeviceId);
            return Task.CompletedTask;
        });

        Assert.Equal(0, buffer.Size);
        Assert.Equal(["good"], delivered); // the queue drained rather than retrying forever
    }

    [Fact]
    public async Task Survives_a_server_whose_cap_is_far_below_the_agent_chunk_size()
    {
        var buffer = new IngestBuffer(TempPath("queue.jsonl"), maxItems: 10);
        buffer.Enqueue(new IngestBatchDto { Checks = Checks(50), Metrics = [] });

        var requests = 0;
        var delivered = new HashSet<string>();
        await buffer.DrainAsync(b =>
        {
            requests++;
            if (Items(b) > 1)
            {
                throw Http(413); // pathological: server accepts one item at a time
            }

            delivered.Add(b.Checks![0].DeviceId);
            return Task.CompletedTask;
        });

        Assert.Equal(50, delivered.Count); // degrades into MORE REQUESTS, never into lost data
        Assert.True(requests > 50);
    }

    [Fact]
    public void A_corrupt_trailing_line_does_not_discard_the_batches_before_it()
    {
        var path = TempPath("queue.jsonl");
        var buffer = new IngestBuffer(path, maxItems: 10);
        buffer.Enqueue(Batch("a"));
        buffer.Enqueue(Batch("b"));
        File.AppendAllText(path, "{\"checks\":[{\"deviceId\":\"trunc"); // crash mid-persist

        Assert.Equal(2, new IngestBuffer(path, maxItems: 10).Size);
    }
}

public class IngestBatchingTests
{
    [Fact]
    public void Chunk_never_emits_over_the_cap_and_preserves_every_item_exactly_once()
    {
        var batch = new IngestBatchDto { Checks = Checks(1200), Metrics = Metrics(700) };
        var chunks = IngestBatching.Chunk(batch, IngestBatching.MaxItemsPerBatch);

        Assert.Equal(3, chunks.Count); // ceil(1200/500)
        foreach (var chunk in chunks)
        {
            Assert.True(chunk.Checks!.Count <= IngestBatching.MaxItemsPerBatch);
            Assert.True(chunk.Metrics!.Count <= IngestBatching.MaxItemsPerBatch);
        }

        Assert.Equal(batch.Checks, chunks.SelectMany(c => c.Checks!));
        Assert.Equal(batch.Metrics, chunks.SelectMany(c => c.Metrics!));
    }

    [Fact]
    public void Chunk_size_stays_at_or_under_the_api_caps_it_is_paired_with()
    {
        // The server (ingest.dto.ts) caps checks and metrics at 1000 each; the agent chunks at half.
        Assert.True(IngestBatching.MaxItemsPerBatch <= 1000);
    }

    [Fact]
    public void Chunk_yields_a_single_empty_chunk_for_an_empty_cycle()
    {
        var chunks = IngestBatching.Chunk(new IngestBatchDto { Checks = [], Metrics = [] }, 500);
        var chunk = Assert.Single(chunks);
        Assert.Empty(chunk.Checks!);
        Assert.Empty(chunk.Metrics!);
    }

    [Fact]
    public void Split_returns_null_when_there_is_nothing_left_to_split()
    {
        Assert.Null(IngestBatching.Split(new IngestBatchDto { Checks = Checks(1), Metrics = [] }));
        Assert.Null(IngestBatching.Split(new IngestBatchDto { Checks = [], Metrics = [] }));
    }

    [Fact]
    public void Split_always_makes_both_halves_strictly_smaller_so_the_retry_loop_terminates()
    {
        IngestBatchDto[] cases =
        [
            new() { Checks = Checks(1), Metrics = Metrics(1) }, // the awkward one: must not return {1,1} + {}
            new() { Checks = Checks(2), Metrics = [] },
            new() { Checks = [], Metrics = Metrics(3) },
            new() { Checks = Checks(7), Metrics = Metrics(4) },
        ];
        foreach (var batch in cases)
        {
            var halves = IngestBatching.Split(batch);
            Assert.NotNull(halves);
            var (first, second) = halves.Value;
            foreach (var half in new[] { first, second })
            {
                Assert.True(Items(half) > 0);
                Assert.True(Items(half) < Items(batch));
            }

            Assert.Equal(Items(batch), Items(first) + Items(second)); // lossless
        }
    }
}
