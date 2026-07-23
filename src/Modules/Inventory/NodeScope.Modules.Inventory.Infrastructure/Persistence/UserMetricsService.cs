using Microsoft.EntityFrameworkCore;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Infrastructure.Persistence;

/// <summary>
/// The browser collector's readings on the <c>DeviceMetric</c> hypertable. Values are bounded
/// on the way in because a realtime payload never passed through request validation, and an
/// unbounded write here grows a retention-managed hypertable at the client's discretion.
/// </summary>
internal sealed class UserMetricsService : IUserMetricsService
{
    private const double MaxMetricValue = 1e9;
    private const int MaxLabelLength = 256;

    private readonly InventoryDbContext _db;

    public UserMetricsService(InventoryDbContext db)
    {
        _db = db;
    }

    public async Task RecordAsync(
        string organizationId,
        string userId,
        MetricsSample sample,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(sample);
        _db.DeviceMetrics.Add(new DeviceMetricRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = organizationId,
            UserId = userId,
            SourceType = "browser",
            BandwidthDown = Bounded(sample.BandwidthDown),
            BandwidthUp = Bounded(sample.BandwidthUp),
            Latency = Bounded(sample.Latency),
            ConnectionQuality = Bounded(sample.ConnectionQuality),
            Time = DateTime.UtcNow,
        });
        await _db.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<UserMetricsSnapshot>> LatestPerUserAsync(
        TimeSpan within,
        CancellationToken cancellationToken)
    {
        // The time bound is load-bearing, not a convenience: without it the query has to
        // consider every chunk in the hypertable's retention to find one row per user, on
        // every cycle.
        var since = DateTime.UtcNow - within;
        var rows = await _db.DeviceMetrics
            .Where(m => m.Time >= since)
            .GroupBy(m => m.UserId)
            .Select(group => group.OrderByDescending(m => m.Time).First())
            .ToListAsync(cancellationToken);

        return
        [
            .. rows.Select(row => new UserMetricsSnapshot(
                row.UserId,
                new MetricsSample(row.BandwidthDown, row.BandwidthUp, row.Latency, row.ConnectionQuality),
                row.Time)),
        ];
    }

    private static double? Bounded(double? value) =>
        value is { } number && double.IsFinite(number) && Math.Abs(number) <= MaxMetricValue ? number : null;

    private static string? Bounded(string? value) =>
        value is not null && value.Length <= MaxLabelLength ? value : null;
}
