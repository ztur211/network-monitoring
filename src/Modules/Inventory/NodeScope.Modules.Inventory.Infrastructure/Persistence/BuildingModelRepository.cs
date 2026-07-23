using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Inventory.Application.BuildingModels;

namespace NodeScope.Modules.Inventory.Infrastructure.Persistence;

internal sealed class BuildingModelRepository : IBuildingModelRepository
{
    private readonly InventoryDbContext _db;

    public BuildingModelRepository(InventoryDbContext db)
    {
        _db = db;
    }

    public Task<bool> ExistsForPropertyAsync(
        string organizationId,
        string propertyId,
        CancellationToken cancellationToken) =>
        _db.BuildingModels.AnyAsync(
            m => m.OrganizationId == organizationId && m.PropertyId == propertyId,
            cancellationToken);
}
