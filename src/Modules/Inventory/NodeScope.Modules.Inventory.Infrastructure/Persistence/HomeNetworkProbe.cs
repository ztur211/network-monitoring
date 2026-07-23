using Microsoft.EntityFrameworkCore;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Infrastructure.Persistence;

/// <summary>
/// Answers Realtime's on-home-network question (Node's <c>NetworksService.checkOnHome</c>).
/// Realtime knows only a user id, so the org is resolved through the user's membership; in the
/// current product a user belongs to at most one org and an org has at most one network.
/// </summary>
internal sealed class HomeNetworkProbe : IHomeNetworkProbe
{
    private readonly InventoryDbContext _db;

    public HomeNetworkProbe(InventoryDbContext db)
    {
        _db = db;
    }

    public async Task<HomeNetworkStatus> CheckAsync(
        string userId,
        string requestIp,
        CancellationToken cancellationToken)
    {
        var network = await _db.Networks
            .Where(n => _db.OrganizationMembers.Any(
                m => m.UserId == userId && m.OrganizationId == n.OrganizationId))
            .OrderByDescending(n => n.CreatedAt)
            .Select(n => new { n.Id, n.HomePublicIp })
            .FirstOrDefaultAsync(cancellationToken);

        if (network is null)
        {
            return new HomeNetworkStatus(null, false);
        }

        var onHome = requestIp.Length > 0
            && network.HomePublicIp is not null
            && network.HomePublicIp == requestIp;
        return new HomeNetworkStatus(network.Id, onHome);
    }
}
