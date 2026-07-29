using System.Globalization;
using Microsoft.Extensions.Logging;
using NodeScope.Modules.Monitoring.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Monitoring.Application.Ingest;

/// <summary>
/// Status-derivation thresholds (env <c>MONITORING_DOWN_THRESHOLD</c> /
/// <c>MONITORING_WARN_LATENCY_MS</c>, defaults 3 / 250). Built by the module registration.
/// </summary>
public sealed record IngestThresholds(int DownThreshold, double WarnLatencyMs)
{
    public static IngestThresholds Default { get; } = new(3, 250);
}

/// <summary>
/// The single monitoring write path (Node's <c>IngestService</c>): the HTTP batch ingest and
/// the embedded prober both funnel through it. Derives state, persists current status plus
/// metric samples, and on a state transition appends a status event and emits
/// <c>v1:device:status</c> scoped to the device's property.
/// </summary>
public sealed class IngestService
{
    public const string DeviceStatusEvent = "v1:device:status";

    private readonly IMonitoringRepository _repo;
    private readonly IRealtimeService _realtime;
    private readonly IngestThresholds _thresholds;
    private readonly IReadOnlyList<IMonitoringAlertSink> _alertSinks;
    private readonly ILogger<IngestService>? _logger;

    public IngestService(
        IMonitoringRepository repo,
        IRealtimeService realtime,
        IngestThresholds thresholds,
        IEnumerable<IMonitoringAlertSink>? alertSinks = null,
        ILogger<IngestService>? logger = null)
    {
        _repo = repo;
        _realtime = realtime;
        _thresholds = thresholds;
        _alertSinks = alertSinks?.ToList() ?? [];
        _logger = logger;
    }

    /// <summary>Single-check write path (the embedded prober). Same semantics as a 1-check batch.</summary>
    public Task ReportStatusCheckAsync(
        string organizationId,
        string deviceId,
        bool ok,
        double? latencyMs,
        string source,
        CancellationToken cancellationToken) =>
        IngestBatchAsync(
            organizationId,
            [new StatusCheckItem { DeviceId = deviceId, Ok = ok, LatencyMs = latencyMs, Source = source }],
            [],
            sourceOverride: null,
            cancellationToken);

    /// <summary>
    /// Set-based ingest for a validated batch. A foreign-org device fails the whole batch with
    /// <c>ORG_008</c> before any write (atomic reject, no partial writes). Deliberate deviation
    /// from Node, recorded in the decision log: duplicate checks for one device collapse to the
    /// LAST one (Node applied all of them in nondeterministic order against the same prior
    /// state; the collapsed form is the deterministic version of the same outcome), because the
    /// batched upsert cannot touch a row twice.
    /// </summary>
    public async Task IngestBatchAsync(
        string organizationId,
        IReadOnlyList<StatusCheckItem> checks,
        IReadOnlyList<MetricSampleItem> metrics,
        string? sourceOverride,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(checks);
        ArgumentNullException.ThrowIfNull(metrics);

        var deviceIds = checks.Select(c => c.DeviceId!)
            .Concat(metrics.Select(m => m.DeviceId!))
            .Distinct(StringComparer.Ordinal)
            .ToList();
        if (deviceIds.Count == 0)
        {
            return;
        }

        var owned = await _repo.ListOwnedDevicesAsync(organizationId, deviceIds, cancellationToken);
        var ownedByDevice = owned.ToDictionary(d => d.Id, StringComparer.Ordinal);
        if (deviceIds.Any(id => !ownedByDevice.ContainsKey(id)))
        {
            throw new ApiException("ORG_008", "CROSS_ORG_ACCESS_DENIED", 404);
        }

        var checkDeviceIds = checks.Select(c => c.DeviceId!).Distinct(StringComparer.Ordinal).ToList();
        var previous = checkDeviceIds.Count > 0
            ? await _repo.ListStatusAsync(organizationId, checkDeviceIds, cancellationToken)
            : [];
        var previousByDevice = previous.ToDictionary(s => s.DeviceId, StringComparer.Ordinal);

        var metricRows = new List<MetricRow>();
        var eventRows = new List<StatusEventRow>();
        var emits = new List<(string PropertyId, object Payload, MonitoringStatusTransition Transition)>();
        var upsertByDevice = new Dictionary<string, StatusUpsert>(StringComparer.Ordinal);

        foreach (var check in checks)
        {
            var deviceId = check.DeviceId!;
            var source = sourceOverride ?? check.Source ?? "agent";
            previousByDevice.TryGetValue(deviceId, out var before);
            var derived = StateDerivation.Derive(
                before?.ConsecutiveFails ?? 0,
                check.Ok!.Value,
                check.LatencyMs,
                _thresholds.DownThreshold,
                _thresholds.WarnLatencyMs);
            var changed = before?.State != derived.State;

            upsertByDevice[deviceId] = new StatusUpsert(
                organizationId,
                deviceId,
                derived.State,
                check.LatencyMs,
                derived.ConsecutiveFails,
                source,
                check.Ok!.Value,
                changed);

            if (check.LatencyMs is not null)
            {
                metricRows.Add(new MetricRow(organizationId, deviceId, "latency_ms", check.LatencyMs.Value, source, Ts: null));
            }

            metricRows.Add(new MetricRow(organizationId, deviceId, "reachable", check.Ok.Value ? 1 : 0, source, Ts: null));

            if (changed)
            {
                var at = DateTime.UtcNow;
                var device = ownedByDevice[deviceId];
                eventRows.Add(new StatusEventRow(organizationId, deviceId, derived.State, source));
                emits.Add((
                    device.PropertyId,
                    new
                    {
                        deviceId,
                        state = DeviceStatusStateLabel.Of(derived.State),
                        latencyMs = check.LatencyMs,
                        at,
                        timestamp = IsoTimestamp.Of(at),
                    },
                    new MonitoringStatusTransition(
                        organizationId,
                        deviceId,
                        device.NetworkId,
                        device.PropertyId,
                        before is null ? null : DeviceStatusStateLabel.Of(before.State),
                        DeviceStatusStateLabel.Of(derived.State),
                        check.LatencyMs,
                        at)));
            }
        }

        foreach (var metric in metrics)
        {
            var source = sourceOverride ?? metric.Source ?? "agent";
            DateTime? ts = metric.Ts is null
                ? null
                : DateTimeOffset.Parse(metric.Ts, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind).UtcDateTime;
            metricRows.Add(new MetricRow(organizationId, metric.DeviceId!, metric.Metric!, metric.Value!.Value, source, ts));
        }

        await _repo.UpsertStatusBatchAsync([.. upsertByDevice.Values], cancellationToken);
        await _repo.InsertMetricsAsync(metricRows, cancellationToken);
        await _repo.InsertStatusEventsAsync(eventRows, cancellationToken);

        foreach (var (propertyId, payload, transition) in emits)
        {
            // Fire-and-forget, like the Node emitter: a realtime failure never fails the ingest.
            _ = _realtime.EmitScopedAsync(organizationId, propertyId, DeviceStatusEvent, payload, CancellationToken.None);

            foreach (var sink in _alertSinks)
            {
                try
                {
                    await sink.OnStatusChangedAsync(transition, cancellationToken);
                }
                catch (Exception failure) when (
                    failure is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
                {
                    if (_logger is not null)
                    {
                        IngestLog.AlertSinkFailed(_logger, sink.GetType().Name, deviceId: transition.DeviceId, failure);
                    }
                }
            }
        }
    }
}

internal static partial class IngestLog
{
    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Error,
        Message = "Alert sink {Sink} failed for device {DeviceId}")]
    public static partial void AlertSinkFailed(
        ILogger logger,
        string sink,
        string deviceId,
        Exception exception);
}
