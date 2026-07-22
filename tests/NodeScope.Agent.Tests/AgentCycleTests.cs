using NodeScope.Agent;
using NodeScope.Contracts.Monitoring;
using Xunit;
using static NodeScope.Agent.Tests.TestData;

namespace NodeScope.Agent.Tests;

public class AgentCycleTests
{
    private static readonly SnmpSessionFactory FakeSnmpFactory = (_, _) => new FakeSnmpSession();

    private static Task<ProbeResult> ProbeUp(string ip, CancellationToken ct) =>
        Task.FromResult(new ProbeResult(true, 3));

    [Fact]
    public async Task Syncs_polls_enqueues_drains_heartbeats()
    {
        var client = new FakeApiClient
        {
            OnSync = () => Task.FromResult<IReadOnlyList<AgentDeviceDto>>([Device("a", "10.0.0.1")]),
        };
        var buffer = new IngestBuffer(TempPath("queue.jsonl"), maxItems: 10);

        await AgentCycle.RunAsync(client, buffer, ProbeUp, concurrency: 4, FakeSnmpFactory, CancellationToken.None);

        Assert.Equal(1, client.SyncCalls);
        var ingested = Assert.Single(client.Ingested); // one chunk enqueued, drained through IngestAsync
        Assert.Equal("a", Assert.Single(ingested.Checks!).DeviceId);
        Assert.Equal(1, client.HeartbeatCalls);
        Assert.Equal(0, buffer.Size);
    }

    [Fact]
    public async Task Still_heartbeats_when_drain_throws()
    {
        var client = new FakeApiClient
        {
            OnSync = () => Task.FromResult<IReadOnlyList<AgentDeviceDto>>([Device("a", "10.0.0.1")]),
            OnIngest = _ => throw new AgentHttpException(503, "ingest 503"),
        };
        var buffer = new IngestBuffer(TempPath("queue.jsonl"), maxItems: 10);

        // The drain error still propagates (the cycle is not silently "successful")...
        var error = await Assert.ThrowsAsync<AgentHttpException>(
            () => AgentCycle.RunAsync(client, buffer, ProbeUp, 4, FakeSnmpFactory, CancellationToken.None));
        Assert.Equal(503, error.StatusCode);
        // ...but the heartbeat went out regardless, so the backend won't mark a healthy agent offline.
        Assert.Equal(1, client.HeartbeatCalls);
    }

    [Fact]
    public async Task Chunks_a_large_fleet_into_server_sized_batches()
    {
        // 1200 devices: one batch per cycle used to mean one request with 1200 checks, which
        // blew past the API's body limit - and the agent then threw the 413'd batch away.
        var devices = Enumerable.Range(0, 1200)
            .Select(i => Device($"d{i}", $"10.0.{i / 256}.{i % 256}"))
            .ToList();
        var client = new FakeApiClient
        {
            OnSync = () => Task.FromResult<IReadOnlyList<AgentDeviceDto>>(devices),
        };
        var buffer = new IngestBuffer(TempPath("queue.jsonl"), maxItems: 10);

        await AgentCycle.RunAsync(client, buffer, ProbeUp, concurrency: 8, FakeSnmpFactory, CancellationToken.None);

        Assert.Equal(3, client.Ingested.Count); // ceil(1200 / 500)
        foreach (var batch in client.Ingested)
        {
            Assert.True(batch.Checks!.Count <= IngestBatching.MaxItemsPerBatch);
            Assert.True(batch.Metrics!.Count <= IngestBatching.MaxItemsPerBatch);
        }

        // Every device is still accounted for - chunking must not lose any.
        Assert.Equal(1200, client.Ingested.SelectMany(b => b.Checks!).Select(c => c.DeviceId).Distinct().Count());
    }
}
