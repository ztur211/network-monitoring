using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Inventory.Application.Properties;

namespace NodeScope.Modules.Inventory.Infrastructure.Persistence;

internal sealed class NetworkPropertyRepository : INetworkPropertyRepository
{
    private readonly InventoryDbContext _db;

    public NetworkPropertyRepository(InventoryDbContext db)
    {
        _db = db;
    }

    public async Task<CharterRecord> CreateAsync(
        string organizationId,
        string networkId,
        string propertyId,
        CancellationToken cancellationToken)
    {
        var row = new NetworkPropertyRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = organizationId,
            NetworkId = networkId,
            PropertyId = propertyId,
            CreatedAt = DateTime.UtcNow,
        };
        _db.NetworkProperties.Add(row);
        await _db.SaveChangesAsync(cancellationToken);
        return new CharterRecord(row.Id, row.OrganizationId, row.NetworkId, row.PropertyId);
    }

    public Task<bool> CharterExistsAsync(
        string organizationId,
        string networkId,
        string propertyId,
        CancellationToken cancellationToken) =>
        _db.NetworkProperties.AnyAsync(
            np => np.OrganizationId == organizationId && np.NetworkId == networkId && np.PropertyId == propertyId,
            cancellationToken);

    public async Task<CharterRecord?> FindCharterAsync(
        string organizationId,
        string networkId,
        string propertyId,
        CancellationToken cancellationToken)
    {
        var row = await _db.NetworkProperties
            .AsNoTracking()
            .SingleOrDefaultAsync(
                np => np.OrganizationId == organizationId && np.NetworkId == networkId && np.PropertyId == propertyId,
                cancellationToken);
        return row is null ? null : new CharterRecord(row.Id, row.OrganizationId, row.NetworkId, row.PropertyId);
    }

    public async Task<IReadOnlyList<CharterRecord>> ListByNetworkAsync(
        string organizationId,
        string networkId,
        CancellationToken cancellationToken)
    {
        var rows = await _db.NetworkProperties
            .Where(np => np.OrganizationId == organizationId && np.NetworkId == networkId)
            .OrderBy(np => np.CreatedAt)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
        return [.. rows.Select(row => new CharterRecord(row.Id, row.OrganizationId, row.NetworkId, row.PropertyId))];
    }

    public async Task<IReadOnlyList<string>> PropertyIdsByNetworkAsync(
        string organizationId,
        string networkId,
        CancellationToken cancellationToken) =>
        await _db.NetworkProperties
            .Where(np => np.OrganizationId == organizationId && np.NetworkId == networkId)
            .Select(np => np.PropertyId)
            .ToListAsync(cancellationToken);

    public Task DeleteAsync(
        string organizationId,
        string networkId,
        string propertyId,
        CancellationToken cancellationToken) =>
        _db.NetworkProperties
            .Where(np => np.OrganizationId == organizationId && np.NetworkId == networkId && np.PropertyId == propertyId)
            .ExecuteDeleteAsync(cancellationToken);

    public async Task<IReadOnlyList<string>> DeviceFootprintPropertyIdsAsync(
        string organizationId,
        string networkId,
        CancellationToken cancellationToken) =>
        await _db.Devices
            .Where(d => d.OrganizationId == organizationId && d.NetworkId == networkId)
            .Select(d => d.PropertyId)
            .Distinct()
            .ToListAsync(cancellationToken);
}
