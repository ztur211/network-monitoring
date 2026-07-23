using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Inventory.Application.Networks;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Infrastructure.Persistence;

internal sealed class NetworkRepository : INetworkRepository
{
    private readonly InventoryDbContext _db;

    public NetworkRepository(InventoryDbContext db)
    {
        _db = db;
    }

    public Task<int> CountByOrgAsync(string organizationId, CancellationToken cancellationToken) =>
        _db.Networks.CountAsync(n => n.OrganizationId == organizationId, cancellationToken);

    public async Task<NetworkRecord?> FindAsync(
        string organizationId,
        string networkId,
        CancellationToken cancellationToken)
    {
        var row = await _db.Networks
            .AsNoTracking()
            .SingleOrDefaultAsync(n => n.Id == networkId && n.OrganizationId == organizationId, cancellationToken);
        return row is null ? null : ToRecord(row);
    }

    public async Task<IReadOnlyList<NetworkRecord>> ListVisibleAsync(
        string organizationId,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken)
    {
        var rows = await VisibleQuery(organizationId, scope)
            .OrderByDescending(n => n.CreatedAt)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
        return [.. rows.Select(ToRecord)];
    }

    public async Task<NetworkRecord?> FindVisibleAsync(
        string organizationId,
        string networkId,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken)
    {
        var row = await VisibleQuery(organizationId, scope)
            .AsNoTracking()
            .SingleOrDefaultAsync(n => n.Id == networkId, cancellationToken);
        return row is null ? null : ToRecord(row);
    }

    public async Task<IReadOnlyList<string>> CharteredPropertyIdsAsync(
        string organizationId,
        string networkId,
        CancellationToken cancellationToken) =>
        await _db.NetworkProperties
            .Where(np => np.OrganizationId == organizationId && np.NetworkId == networkId)
            .Select(np => np.PropertyId)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<string>> DeviceFootprintPropertyIdsAsync(
        string organizationId,
        string networkId,
        CancellationToken cancellationToken) =>
        await _db.Devices
            .Where(d => d.OrganizationId == organizationId && d.NetworkId == networkId)
            .Select(d => d.PropertyId)
            .Distinct()
            .ToListAsync(cancellationToken);

    public async Task<NetworkRecord> CreateAsync(NewNetwork network, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var row = new NetworkRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = network.OrganizationId,
            UserId = network.UserId,
            Name = network.Name,
            HomeAddress = network.HomeAddress,
            HomeLatitude = network.HomeLatitude,
            HomeLongitude = network.HomeLongitude,
            HomePublicIp = network.HomePublicIp,
            Isp = network.Isp,
            DownMbps = network.DownMbps,
            UpMbps = network.UpMbps,
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.Networks.Add(row);
        await _db.SaveChangesAsync(cancellationToken);
        return ToRecord(row);
    }

    public async Task<NetworkRecord?> UpdateWithVersionAsync(
        string organizationId,
        string networkId,
        IReadOnlyDictionary<string, JsonElement> fields,
        int expectedVersion,
        CancellationToken cancellationToken)
    {
        var updated = await _db.Networks
            .Where(n => n.Id == networkId && n.OrganizationId == organizationId && n.Version == expectedVersion)
            .ExecuteUpdateAsync(
                setters =>
                {
                    setters.SetProperty(n => n.Version, n => n.Version + 1);
                    setters.SetProperty(n => n.UpdatedAt, DateTime.UtcNow);
                    foreach (var (field, value) in fields)
                    {
                        switch (field)
                        {
                            case "name":
                                setters.SetProperty(n => n.Name, ChangesetValues.AsString(value)!);
                                break;
                            case "homeAddress":
                                setters.SetProperty(n => n.HomeAddress, ChangesetValues.AsString(value));
                                break;
                            case "homeLatitude":
                                setters.SetProperty(n => n.HomeLatitude, ChangesetValues.AsDouble(value));
                                break;
                            case "homeLongitude":
                                setters.SetProperty(n => n.HomeLongitude, ChangesetValues.AsDouble(value));
                                break;
                            case "homePublicIp":
                                setters.SetProperty(n => n.HomePublicIp, ChangesetValues.AsString(value));
                                break;
                            case "isp":
                                setters.SetProperty(n => n.Isp, ChangesetValues.AsString(value));
                                break;
                            case "downMbps":
                                setters.SetProperty(n => n.DownMbps, ChangesetValues.AsDouble(value));
                                break;
                            case "upMbps":
                                setters.SetProperty(n => n.UpMbps, ChangesetValues.AsDouble(value));
                                break;
                            default:
                                throw new ArgumentOutOfRangeException(nameof(fields), field, "not a writable Network field");
                        }
                    }
                },
                cancellationToken);
        return updated == 0 ? null : await FindAsync(organizationId, networkId, cancellationToken);
    }

    public Task DeleteAsync(string organizationId, string networkId, CancellationToken cancellationToken) =>
        _db.Networks
            .Where(n => n.Id == networkId && n.OrganizationId == organizationId)
            .ExecuteDeleteAsync(cancellationToken);

    private IQueryable<NetworkRow> VisibleQuery(string organizationId, IReadOnlyCollection<string>? scope)
    {
        var query = _db.Networks.Where(n => n.OrganizationId == organizationId);
        if (scope is not null)
        {
            query = query.Where(n =>
                _db.NetworkProperties.Any(np => np.NetworkId == n.Id && scope.Contains(np.PropertyId))
                || _db.Devices.Any(d => d.NetworkId == n.Id && scope.Contains(d.PropertyId)));
        }

        return query;
    }

    private static NetworkRecord ToRecord(NetworkRow row) => new(
        row.Id, row.OrganizationId, row.UserId, row.Name, row.HomeAddress, row.HomeLatitude, row.HomeLongitude,
        row.HomePublicIp, row.Isp, row.DownMbps, row.UpMbps, row.Version, row.CreatedAt, row.UpdatedAt);
}
