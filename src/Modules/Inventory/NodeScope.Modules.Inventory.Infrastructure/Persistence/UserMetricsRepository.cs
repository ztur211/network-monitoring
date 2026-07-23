using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Inventory.Application.Clients;

namespace NodeScope.Modules.Inventory.Infrastructure.Persistence;

internal sealed class UserMetricsRepository : IUserMetricsRepository
{
    private readonly InventoryDbContext _db;

    public UserMetricsRepository(InventoryDbContext db)
    {
        _db = db;
    }

    public async Task<MetricsDto?> LatestForUserAsync(
        string organizationId,
        string userId,
        CancellationToken cancellationToken) =>
        await _db.DeviceMetrics
            .Where(m => m.OrganizationId == organizationId && m.UserId == userId)
            .OrderByDescending(m => m.Time)
            .Select(m => new MetricsDto(m.BandwidthDown, m.BandwidthUp, m.Latency, m.ConnectionQuality, m.Time))
            .FirstOrDefaultAsync(cancellationToken);
}
