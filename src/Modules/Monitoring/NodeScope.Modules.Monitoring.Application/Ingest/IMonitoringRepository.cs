using NodeScope.Modules.Monitoring.Domain;

namespace NodeScope.Modules.Monitoring.Application.Ingest;

/// <summary>A device's current status row (the write path reads prior state from it).</summary>
public sealed record DeviceStatusRecord(
    string DeviceId,
    DeviceStatusState State,
    double? LatencyMs,
    int ConsecutiveFails,
    DateTime? LastCheckAt,
    DateTime? LastOkAt,
    DateTime? LastChangeAt,
    string? Source);

/// <summary>One status upsert (Node's <c>upsertStatus</c> input).</summary>
public sealed record StatusUpsert(
    string OrganizationId,
    string DeviceId,
    DeviceStatusState State,
    double? LatencyMs,
    int ConsecutiveFails,
    string Source,
    bool Ok,
    bool Changed);

/// <summary>One row bound for the <c>MonitoringMetric</c> hypertable.</summary>
public sealed record MetricRow(
    string OrganizationId,
    string DeviceId,
    string Metric,
    double Value,
    string Source,
    DateTime? Ts);

/// <summary>One row bound for the <c>DeviceStatusEvent</c> hypertable.</summary>
public sealed record StatusEventRow(
    string OrganizationId,
    string DeviceId,
    DeviceStatusState State,
    string Source);

/// <summary>A device-ownership row: id plus the property it sits on (the emit scope).</summary>
public sealed record OwnedDevice(string Id, string PropertyId);

/// <summary>
/// The monitoring write/read persistence surface over <c>DeviceStatus</c> (EF-managed) and the
/// two raw-SQL hypertables (never EF-mapped, exactly as they were <c>@@ignore</c>'d for Prisma).
/// </summary>
public interface IMonitoringRepository
{
    /// <summary>Devices in <paramref name="deviceIds"/> owned by the org, with their property.</summary>
    public Task<IReadOnlyList<OwnedDevice>> ListOwnedDevicesAsync(
        string organizationId,
        IReadOnlyCollection<string> deviceIds,
        CancellationToken cancellationToken);

    public Task<DeviceStatusRecord?> GetStatusAsync(
        string organizationId,
        string deviceId,
        CancellationToken cancellationToken);

    public Task<IReadOnlyList<DeviceStatusRecord>> ListStatusAsync(
        string organizationId,
        IReadOnlyCollection<string> deviceIds,
        CancellationToken cancellationToken);

    /// <summary>
    /// Applies every upsert in one <c>INSERT .. ON CONFLICT ("deviceId") DO UPDATE</c>.
    /// Rows must be unique per device (the service collapses duplicates; Postgres refuses to
    /// touch the same row twice in one statement). Per-row semantics match Node's
    /// <c>upsertStatus</c>: <c>lastOkAt</c> only advances on an ok check, <c>lastChangeAt</c>
    /// only on a transition.
    /// </summary>
    public Task UpsertStatusBatchAsync(IReadOnlyList<StatusUpsert> upserts, CancellationToken cancellationToken);

    public Task InsertMetricsAsync(IReadOnlyList<MetricRow> rows, CancellationToken cancellationToken);

    public Task InsertStatusEventsAsync(IReadOnlyList<StatusEventRow> rows, CancellationToken cancellationToken);

    /// <summary>One owned device (id + property), or null when unknown/foreign.</summary>
    public Task<OwnedDevice?> FindOwnedDeviceAsync(
        string organizationId,
        string deviceId,
        CancellationToken cancellationToken);

    /// <summary>Ids of the org's devices sitting on any of <paramref name="propertyIds"/>, newest first.</summary>
    public Task<IReadOnlyList<string>> ListDeviceIdsUnderPropertiesAsync(
        string organizationId,
        IReadOnlyCollection<string> propertyIds,
        CancellationToken cancellationToken);

    /// <summary>Distinct metric names for a device since <paramref name="sinceUtc"/>, sorted.</summary>
    public Task<IReadOnlyList<string>> MetricNamesAsync(
        string organizationId,
        string deviceId,
        DateTime sinceUtc,
        CancellationToken cancellationToken);

    /// <summary>Recent status transitions, newest first, capped at <paramref name="limit"/>.</summary>
    public Task<IReadOnlyList<Reads.StatusEventDto>> RecentStatusEventsAsync(
        string organizationId,
        string deviceId,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>
    /// Bucketed averages; served from the 5-min continuous aggregate when the window is
    /// grid-aligned (falling back to raw if the aggregate is absent), from raw otherwise.
    /// </summary>
    public Task<IReadOnlyList<Reads.MetricPointDto>> QueryMetricAsync(
        string organizationId,
        string deviceId,
        string metric,
        DateTime fromUtc,
        DateTime toUtc,
        string bucket,
        CancellationToken cancellationToken);
}
