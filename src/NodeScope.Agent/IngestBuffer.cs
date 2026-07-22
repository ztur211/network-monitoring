using System.Text.Json;
using NodeScope.Contracts.Monitoring;

namespace NodeScope.Agent;

internal static class IngestBatching
{
    /// <summary>
    /// Items per ingest request, counted per array (checks and metrics are capped separately).
    ///
    /// MUST stay at or below the API's per-batch caps (INGEST_MAX_CHECKS_PER_BATCH /
    /// INGEST_MAX_METRICS_PER_BATCH, currently 1000 each). It is deliberately HALF of them:
    /// the agent ships independently of the API, so an operator can be running a new agent
    /// against an older API (or the reverse), and half leaves room for the server's cap to be
    /// lowered without instantly breaking every agent in the field.
    ///
    /// The chunk size is only an optimisation, though - never the safety property. The agent
    /// cannot import the server's constant, and a cap the client does not know about is
    /// precisely how this broke the first time (one batch containing EVERY device blew the
    /// body limit past ~800 devices, and the agent threw the refused batch away). Correctness
    /// rests on DrainAsync treating a 413 as "split and retry": if these two numbers ever
    /// drift apart, the fleet degrades into MORE REQUESTS, never into lost data.
    /// </summary>
    internal const int MaxItemsPerBatch = 500;

    internal static int ItemCount(IngestBatchDto batch) =>
        (batch.Checks?.Count ?? 0) + (batch.Metrics?.Count ?? 0);

    /// <summary>
    /// Slice a poll cycle's batch into requests of at most <paramref name="maxItems"/> checks
    /// and <paramref name="maxItems"/> metrics. Both arrays are sliced at the same offset, so
    /// a device's check and its metrics usually land in the same request. An empty batch still
    /// yields one (empty) chunk, preserving the caller's one-enqueue-per-cycle behaviour.
    /// </summary>
    internal static IReadOnlyList<IngestBatchDto> Chunk(IngestBatchDto batch, int maxItems)
    {
        var checks = batch.Checks ?? [];
        var metrics = batch.Metrics ?? [];
        var count = Math.Max(1, (int)Math.Ceiling(Math.Max(checks.Count, metrics.Count) / (double)maxItems));
        var chunks = new List<IngestBatchDto>(count);
        for (var i = 0; i < count; i++)
        {
            chunks.Add(new IngestBatchDto
            {
                Checks = Slice(checks, i * maxItems, maxItems),
                Metrics = Slice(metrics, i * maxItems, maxItems),
            });
        }

        return chunks;
    }

    /// <summary>
    /// Halve a batch the server refused as too large. Returns null when it holds at most one
    /// item and therefore cannot be split any further.
    ///
    /// Checks round up and metrics round down so that BOTH halves are strictly smaller than
    /// the input even in the awkward {1 check, 1 metric} case (-> {1 check} + {1 metric}, not
    /// {1,1} + {}). That strict decrease is what guarantees the retry loop in DrainAsync
    /// terminates.
    /// </summary>
    internal static (IngestBatchDto First, IngestBatchDto Second)? Split(IngestBatchDto batch)
    {
        var checks = batch.Checks ?? [];
        var metrics = batch.Metrics ?? [];
        if (checks.Count + metrics.Count <= 1)
        {
            return null;
        }

        var c = (checks.Count + 1) / 2;
        var m = metrics.Count / 2;
        return (
            new IngestBatchDto { Checks = Slice(checks, 0, c), Metrics = Slice(metrics, 0, m) },
            new IngestBatchDto { Checks = Slice(checks, c, int.MaxValue), Metrics = Slice(metrics, m, int.MaxValue) });
    }

    private static List<T> Slice<T>(IReadOnlyList<T> source, int offset, int count)
    {
        var end = (int)Math.Min((long)offset + count, source.Count);
        var result = new List<T>(Math.Max(0, end - offset));
        for (var i = offset; i < end; i++)
        {
            result.Add(source[i]);
        }

        return result;
    }
}

/// <summary>
/// A disk-backed FIFO of ingest batches (JSONL), so samples survive an agent restart and an
/// API outage. Enqueue evicts oldest beyond the cap; drain applies the retry policy that
/// distinguishes "too big" (split), "rejected" (drop) and "transient" (keep and stop).
/// </summary>
internal sealed class IngestBuffer
{
    private readonly string _path;
    private readonly int _maxItems;
    private readonly List<IngestBatchDto> _pending = [];

    public IngestBuffer(string path, int maxItems)
    {
        _path = path;
        _maxItems = maxItems;
        LoadFromDisk();
    }

    public int Size => _pending.Count;

    public void Enqueue(IngestBatchDto batch)
    {
        _pending.Add(batch);
        if (_pending.Count > _maxItems)
        {
            _pending.RemoveRange(0, _pending.Count - _maxItems);
        }

        Persist();
    }

    public async Task DrainAsync(Func<IngestBatchDto, Task> flush)
    {
        while (_pending.Count > 0)
        {
            try
            {
                await flush(_pending[0]);
            }
            catch (AgentHttpException e) when (e.StatusCode == 413)
            {
                // 413 is "too big", not "bad" - the ONLY honest response is to make the batch
                // smaller and try again. Splitting (rather than dropping) is what stops a fleet
                // outgrowing the server's cap from silently destroying its monitoring data: it
                // degrades into more, and smaller, requests. Each half is strictly smaller, so
                // this terminates.
                var halves = IngestBatching.Split(_pending[0]);
                if (halves is { } split)
                {
                    await Console.Error.WriteLineAsync(
                        $"[agent] ingest 413: splitting batch of {IngestBatching.ItemCount(_pending[0])} items and retrying");
                    // Deliberately NOT subject to the maxItems eviction. That cap is enqueue-time
                    // backpressure on the number of QUEUED CYCLES; applying it here would drop the
                    // very data we are trying to preserve.
                    _pending.RemoveAt(0);
                    _pending.Insert(0, split.Second);
                    _pending.Insert(0, split.First);
                    Persist();
                    continue;
                }

                // A single item the server still calls too large is malformed, not merely
                // oversized (nothing legitimate serializes that big). Splitting cannot help, so
                // drop it rather than retry it forever - one poisoned sample must not wedge the
                // whole queue.
                await Console.Error.WriteLineAsync("[agent] dropping single-item batch (413, cannot split further)");
                _pending.RemoveAt(0);
                Persist();
                continue;
            }
            catch (AgentHttpException e) when (e.StatusCode is >= 400 and < 500 and not 429)
            {
                await Console.Error.WriteLineAsync($"[agent] dropping batch (permanent {e.StatusCode})");
                _pending.RemoveAt(0);
                Persist();
                continue;
            }

            // Transient failures (5xx, 429, network, timeout) propagate out of DrainAsync:
            // keep the head batch and stop draining, to retry next cycle.
            _pending.RemoveAt(0);
            Persist();
        }
    }

    private void LoadFromDisk()
    {
        string[] lines;
        try
        {
            lines = File.ReadAllLines(_path);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return;
        }

        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            // Per-line resilience (deliberately better than the Node agent, which discarded the
            // whole queue on any bad line): a crash mid-persist truncates the final line, and
            // that must not cost the batches before it.
            try
            {
                var batch = JsonSerializer.Deserialize(line, AgentJsonContext.Default.IngestBatchDto);
                if (batch is not null)
                {
                    _pending.Add(batch);
                }
            }
            catch (JsonException)
            {
                Console.Error.WriteLine("[agent] skipping corrupt queue line");
            }
        }
    }

    private void Persist()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        File.WriteAllLines(_path, _pending.Select(b => JsonSerializer.Serialize(b, AgentJsonContext.Default.IngestBatchDto)));
    }
}
