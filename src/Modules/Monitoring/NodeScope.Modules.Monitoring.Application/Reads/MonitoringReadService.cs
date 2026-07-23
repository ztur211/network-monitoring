using System.Globalization;
using NodeScope.Modules.Monitoring.Application.Ingest;
using NodeScope.Modules.Monitoring.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Monitoring.Application.Reads;

/// <summary>The device-status wire DTO; a device with no status row reads as UNKNOWN with nulls.</summary>
public sealed record DeviceStatusDto(
    string DeviceId,
    string State,
    double? LatencyMs,
    DateTime? LastCheckAt,
    DateTime? LastOkAt,
    DateTime? LastChangeAt);

/// <summary>One chart point: the bucket start and the average value inside it.</summary>
public sealed record MetricPointDto(DateTime Bucket, double Avg);

/// <summary>One status transition, newest-first on the wire.</summary>
public sealed record StatusEventDto(DateTime Time, string State, string? Source);

/// <summary>The validated, defaulted metrics query.</summary>
public sealed record MetricsQuery(string Metric, DateTime FromUtc, DateTime ToUtc, string Bucket);

/// <summary>
/// The F3-scoped monitoring read side (Node's <c>MonitoringService</c>). Everything a caller
/// cannot see is invisible-not-forbidden: wrong org and out-of-scope devices 404 identically
/// (<c>DEVICE_001</c>), so the endpoint cannot be used as an existence oracle. Window rules
/// (<c>MON_001</c>/<c>MON_002</c>) run BEFORE the visibility check, matching Node's order.
/// </summary>
public sealed class MonitoringReadService
{
    private readonly IMonitoringRepository _repo;
    private readonly IPermissionScopeService _scope;

    public MonitoringReadService(IMonitoringRepository repo, IPermissionScopeService scope)
    {
        _repo = repo;
        _scope = scope;
    }

    /// <summary>Status for every in-scope device at/under a building; no status row = UNKNOWN.</summary>
    public async Task<IReadOnlyList<DeviceStatusDto>> GetBuildingDeviceStatusAsync(
        OrgMemberContext member,
        string buildingPropertyId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var subtree = await _scope.SubtreePropertyIdsAsync(member.OrganizationId, buildingPropertyId, cancellationToken);
        var scope = await _scope.ScopePropertyIdsAsync(member, cancellationToken);
        IReadOnlyList<string> propertyIds = scope is null
            ? subtree
            : [.. subtree.Where(id => scope.Contains(id, StringComparer.Ordinal))];
        if (propertyIds.Count == 0)
        {
            return [];
        }

        var deviceIds = await _repo.ListDeviceIdsUnderPropertiesAsync(member.OrganizationId, propertyIds, cancellationToken);
        if (deviceIds.Count == 0)
        {
            return [];
        }

        var statuses = await _repo.ListStatusAsync(member.OrganizationId, deviceIds, cancellationToken);
        var byId = statuses.ToDictionary(s => s.DeviceId, StringComparer.Ordinal);
        return [.. deviceIds.Select(id => ToDto(id, byId.TryGetValue(id, out var status) ? status : null))];
    }

    /// <summary>Bucketed averages for one device metric over a bounded window.</summary>
    public async Task<IReadOnlyList<MetricPointDto>> GetDeviceMetricsAsync(
        OrgMemberContext member,
        string deviceId,
        string metric,
        string? from,
        string? to,
        string? bucket,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var query = ResolveMetricWindow(metric, from, to, bucket);
        await AssertDeviceVisibleAsync(member, deviceId, cancellationToken);
        return await _repo.QueryMetricAsync(
            member.OrganizationId,
            deviceId,
            query.Metric,
            query.FromUtc,
            query.ToUtc,
            query.Bucket,
            cancellationToken);
    }

    /// <summary>Distinct metric names seen for the device in the last 24 hours.</summary>
    public async Task<IReadOnlyList<string>> GetDeviceMetricNamesAsync(
        OrgMemberContext member,
        string deviceId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        await AssertDeviceVisibleAsync(member, deviceId, cancellationToken);
        return await _repo.MetricNamesAsync(
            member.OrganizationId,
            deviceId,
            DateTime.UtcNow.AddHours(-24),
            cancellationToken);
    }

    /// <summary>Recent status transitions, newest first, clamped to 1..200 (default 50).</summary>
    public async Task<IReadOnlyList<StatusEventDto>> GetDeviceStatusEventsAsync(
        OrgMemberContext member,
        string deviceId,
        string? limit,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        await AssertDeviceVisibleAsync(member, deviceId, cancellationToken);

        // Node: Number(limit) with NaN/0 falling back to 50, then clamped to [1, 200].
        var parsed = double.TryParse(limit, NumberStyles.Float, CultureInfo.InvariantCulture, out var value)
            ? value
            : double.NaN;
        var effective = double.IsNaN(parsed) || parsed == 0 ? 50 : parsed;
        var capped = (int)Math.Min(Math.Max(1, effective), 200);
        return await _repo.RecentStatusEventsAsync(member.OrganizationId, deviceId, capped, cancellationToken);
    }

    private static MetricsQuery ResolveMetricWindow(string metric, string? from, string? to, string? bucket)
    {
        var effectiveBucket = bucket ?? MetricBuckets.DefaultBucket;
        var toUtc = to is null ? DateTime.UtcNow : ParseIso(to);
        var fromUtc = from is null ? toUtc.AddMilliseconds(-MetricBuckets.DefaultWindowMs) : ParseIso(from);

        if (fromUtc >= toUtc)
        {
            throw new ApiException("MON_001", "INVALID_TIME_RANGE", 400);
        }

        var seconds = MetricBuckets.BucketSeconds(effectiveBucket);
        var buckets = seconds > 0 ? (toUtc - fromUtc).TotalSeconds / seconds : double.PositiveInfinity;
        if (buckets > MetricBuckets.MaxMetricBuckets)
        {
            throw new ApiException("MON_002", "METRIC_RANGE_TOO_LARGE", 400);
        }

        return new MetricsQuery(metric, fromUtc, toUtc, effectiveBucket);
    }

    private static DateTime ParseIso(string value) =>
        DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind).UtcDateTime;

    private async Task AssertDeviceVisibleAsync(
        OrgMemberContext member,
        string deviceId,
        CancellationToken cancellationToken)
    {
        var device = await _repo.FindOwnedDeviceAsync(member.OrganizationId, deviceId, cancellationToken);
        if (device is null)
        {
            throw DeviceNotFound();
        }

        if (member.Role != OrgRoleNames.Owner
            && !await _scope.IsInScopeAsync(member, device.PropertyId, cancellationToken))
        {
            throw DeviceNotFound();
        }
    }

    private static ApiException DeviceNotFound() => new("DEVICE_001", "DEVICE_NOT_FOUND", 404);

    private static DeviceStatusDto ToDto(string deviceId, DeviceStatusRecord? status) =>
        new(
            deviceId,
            status is null ? "UNKNOWN" : DeviceStatusStateLabel.Of(status.State),
            status?.LatencyMs,
            status?.LastCheckAt,
            status?.LastOkAt,
            status?.LastChangeAt);
}
