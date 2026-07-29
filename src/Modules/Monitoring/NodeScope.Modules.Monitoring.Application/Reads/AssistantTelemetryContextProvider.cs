using NodeScope.Modules.Monitoring.Application.Ingest;
using NodeScope.Modules.Monitoring.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Monitoring.Application.Reads;

/// <summary>Produces a bounded one-hour telemetry summary for focused troubleshooting.</summary>
public sealed class AssistantTelemetryContextProvider : IAssistantTelemetryContextProvider
{
    private const int MaxMetrics = 6;
    private const int MaxStatusEvents = 10;
    private readonly IMonitoringRepository _repository;
    private readonly TimeProvider _time;

    public AssistantTelemetryContextProvider(
        IMonitoringRepository repository,
        TimeProvider time)
    {
        _repository = repository;
        _time = time;
    }

    public async Task<AssistantTelemetryContext> GetAsync(
        string organizationId,
        string deviceId,
        CancellationToken cancellationToken)
    {
        var to = _time.GetUtcNow().UtcDateTime;
        var from = to.AddHours(-1);
        var status = await _repository.GetStatusAsync(
            organizationId,
            deviceId,
            cancellationToken);
        var metricNames = await _repository.MetricNamesAsync(
            organizationId,
            deviceId,
            from,
            cancellationToken);
        var metrics = new List<AssistantMetricContext>();
        foreach (var metricName in metricNames.Take(MaxMetrics))
        {
            var points = await _repository.QueryMetricAsync(
                organizationId,
                deviceId,
                metricName,
                from,
                to,
                MetricBuckets.DefaultBucket,
                cancellationToken);
            if (points.Count == 0)
            {
                continue;
            }

            metrics.Add(new AssistantMetricContext(
                metricName,
                points[^1].Avg,
                points.Average(point => point.Avg),
                points.Min(point => point.Avg),
                points.Max(point => point.Avg),
                points[^1].Bucket));
        }

        var events = await _repository.RecentStatusEventsAsync(
            organizationId,
            deviceId,
            MaxStatusEvents,
            cancellationToken);
        return new AssistantTelemetryContext(
            status is null ? "UNKNOWN" : DeviceStatusStateLabel.Of(status.State),
            status?.LatencyMs,
            status?.LastCheckAt,
            metrics,
            [.. events.Select(item =>
                new AssistantStatusEventContext(item.Time, item.State, item.Source))]);
    }
}
