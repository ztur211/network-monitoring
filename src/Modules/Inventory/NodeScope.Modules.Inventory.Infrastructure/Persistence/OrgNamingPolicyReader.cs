using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Inventory.Application.Devices;

namespace NodeScope.Modules.Inventory.Infrastructure.Persistence;

internal sealed class OrgNamingPolicyReader : IOrgNamingPolicyReader
{
    private readonly InventoryDbContext _db;

    public OrgNamingPolicyReader(InventoryDbContext db)
    {
        _db = db;
    }

    public async Task<OrgNamingPolicy?> FindAsync(string organizationId, CancellationToken cancellationToken) =>
        await _db.Organizations
            .Where(o => o.Id == organizationId)
            .Select(o => new OrgNamingPolicy(o.NamingPattern, o.NamingMaxLen, o.NamingTemplate))
            .SingleOrDefaultAsync(cancellationToken);
}
