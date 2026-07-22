using NodeScope.Contracts.Monitoring;

namespace NodeScope.Agent;

internal sealed record CollectResult(IReadOnlyList<StatusCheckDto> Checks, IReadOnlyList<MetricSampleDto> Metrics)
{
    public static CollectResult Empty { get; } = new([], []);
}

internal interface ICollector
{
    public Task<CollectResult> CollectAsync(AgentDeviceDto device, CancellationToken cancellationToken);
}

/// <summary>Emits one reachability check per device, plus a latency metric when measured.</summary>
internal sealed class ReachabilityCollector(Func<string, CancellationToken, Task<ProbeResult>> probe) : ICollector
{
    public async Task<CollectResult> CollectAsync(AgentDeviceDto device, CancellationToken cancellationToken)
    {
        var result = await probe(device.IpAddress, cancellationToken);
        var checks = new List<StatusCheckDto>
        {
            new() { DeviceId = device.Id, Ok = result.Ok, LatencyMs = result.LatencyMs },
        };
        var metrics = result.LatencyMs is { } latency
            ? new List<MetricSampleDto> { new() { DeviceId = device.Id, Metric = "latency_ms", Value = latency } }
            : [];
        return new CollectResult(checks, metrics);
    }
}

internal static class DevicePoller
{
    /// <summary>
    /// Run every collector over every device with bounded concurrency. The bound exists
    /// because the fleet size grows with the customer: an unbounded fan-out over a few
    /// thousand devices holds a few thousand sockets and ping children at once - the
    /// fan-out is the outage.
    /// </summary>
    public static async Task<IngestBatchDto> PollAsync(
        IReadOnlyList<AgentDeviceDto> devices,
        IReadOnlyList<ICollector> collectors,
        int concurrency,
        CancellationToken cancellationToken)
    {
        var checks = new List<StatusCheckDto>();
        var metrics = new List<MetricSampleDto>();
        var gate = new object();
        var options = new ParallelOptions
        {
            MaxDegreeOfParallelism = Math.Max(1, concurrency),
            CancellationToken = cancellationToken,
        };
        await Parallel.ForEachAsync(devices, options, async (device, token) =>
        {
            foreach (var collector in collectors)
            {
                var result = await collector.CollectAsync(device, token);
                lock (gate)
                {
                    checks.AddRange(result.Checks);
                    metrics.AddRange(result.Metrics);
                }
            }
        });

        return new IngestBatchDto { Checks = checks, Metrics = metrics };
    }
}
