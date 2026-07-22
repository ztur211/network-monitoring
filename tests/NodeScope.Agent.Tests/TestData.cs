using NodeScope.Agent;
using NodeScope.Contracts.Monitoring;

namespace NodeScope.Agent.Tests;

internal static class TestData
{
    public static List<StatusCheckDto> Checks(int count, int offset = 0) =>
        Enumerable.Range(0, count)
            .Select(i => new StatusCheckDto { DeviceId = $"d{i + offset}", Ok = true })
            .ToList();

    public static List<MetricSampleDto> Metrics(int count, int offset = 0) =>
        Enumerable.Range(0, count)
            .Select(i => new MetricSampleDto { DeviceId = $"d{i + offset}", Metric = "latency_ms", Value = 1 })
            .ToList();

    public static int Items(IngestBatchDto batch) => IngestBatching.ItemCount(batch);

    public static AgentDeviceDto Device(string id = "dev-x", string ip = "10.0.0.99", SnmpTargetDto? snmp = null) =>
        new() { Id = id, Name = "TestDevice", IpAddress = ip, Snmp = snmp };

    public static string TempPath(string fileName)
    {
        var dir = Path.Combine(Path.GetTempPath(), $"agent-tests-{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, fileName);
    }
}

/// <summary>A fake ISnmpSession with injectable behaviour, mirroring the vitest makeSession helper.</summary>
internal sealed class FakeSnmpSession : ISnmpSession
{
    public Func<IReadOnlyList<string>, Task<IReadOnlyDictionary<string, double>>> OnGet { get; init; } =
        _ => Task.FromResult<IReadOnlyDictionary<string, double>>(new Dictionary<string, double>());

    public Func<string, Task<IReadOnlyDictionary<string, double>>> OnWalk { get; init; } =
        _ => Task.FromResult<IReadOnlyDictionary<string, double>>(new Dictionary<string, double>());

    public List<IReadOnlyList<string>> GetCalls { get; } = [];

    public List<string> WalkCalls { get; } = [];

    public int DisposeCount { get; private set; }

    public Task<IReadOnlyDictionary<string, double>> GetAsync(
        IReadOnlyList<string> oids, CancellationToken cancellationToken)
    {
        GetCalls.Add(oids);
        return OnGet(oids);
    }

    public Task<IReadOnlyDictionary<string, double>> WalkColumnAsync(string oid, CancellationToken cancellationToken)
    {
        WalkCalls.Add(oid);
        return OnWalk(oid);
    }

    public void Dispose() => DisposeCount++;
}

/// <summary>A programmable IAgentApiClient for cycle tests.</summary>
internal sealed class FakeApiClient : IAgentApiClient
{
    public Func<Task<IReadOnlyList<AgentDeviceDto>>> OnSync { get; set; } =
        () => Task.FromResult<IReadOnlyList<AgentDeviceDto>>([]);

    public Func<IngestBatchDto, Task> OnIngest { get; set; } = _ => Task.CompletedTask;

    public int SyncCalls { get; private set; }

    public int HeartbeatCalls { get; private set; }

    public List<IngestBatchDto> Ingested { get; } = [];

    public Task<IReadOnlyList<AgentDeviceDto>> SyncDevicesAsync(CancellationToken cancellationToken)
    {
        SyncCalls++;
        return OnSync();
    }

    public Task IngestAsync(IngestBatchDto batch, CancellationToken cancellationToken)
    {
        Ingested.Add(batch);
        return OnIngest(batch);
    }

    public Task HeartbeatAsync(CancellationToken cancellationToken)
    {
        HeartbeatCalls++;
        return Task.CompletedTask;
    }
}
