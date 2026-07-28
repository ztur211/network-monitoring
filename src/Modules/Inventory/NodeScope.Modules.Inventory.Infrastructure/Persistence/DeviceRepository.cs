using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Inventory.Application.Devices;
using NodeScope.Modules.Inventory.Domain;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Data;

namespace NodeScope.Modules.Inventory.Infrastructure.Persistence;

internal sealed class DeviceRepository : IDeviceRepository
{
    private readonly InventoryDbContext _db;

    public DeviceRepository(InventoryDbContext db)
    {
        _db = db;
    }

    public async Task<IReadOnlyList<DeviceRecord>> ListAsync(
        string organizationId,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken)
    {
        var rows = await ScopedQuery(organizationId, scope)
            .OrderByDescending(d => d.CreatedAt)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
        return [.. rows.Select(ToRecord)];
    }

    public Task<int> CountAsync(
        string organizationId,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken) =>
        ScopedQuery(organizationId, scope).CountAsync(cancellationToken);

    public async Task<DeviceRecord?> FindAsync(
        string organizationId,
        string deviceId,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken)
    {
        var row = await ScopedQuery(organizationId, scope)
            .AsNoTracking()
            .SingleOrDefaultAsync(d => d.Id == deviceId, cancellationToken);
        return row is null ? null : ToRecord(row);
    }

    public async Task<DeviceRecord> CreateAsync(NewDevice device, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(device);
        var now = DateTime.UtcNow;
        var row = new DeviceRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = device.OrganizationId,
            UserId = device.UserId,
            NetworkId = device.NetworkId,
            PropertyId = device.PropertyId,
            RoleCode = device.RoleCode,
            Name = device.Name,
            Category = device.Category,
            Mobility = device.Mobility,
            Latitude = device.Latitude,
            Longitude = device.Longitude,
            Floor = device.Floor,
            FloorLabel = device.FloorLabel,
            IpAddress = device.IpAddress,
            MacAddress = device.MacAddress,
            Notes = device.Notes,
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.Devices.Add(row);
        await _db.SaveChangesAsync(cancellationToken);
        return ToRecord(row);
    }

    public async Task<DeviceRecord?> UpdateWithVersionAsync(
        string organizationId,
        string deviceId,
        IReadOnlyDictionary<string, JsonElement> fields,
        bool clearModelCoordinates,
        int expectedVersion,
        CancellationToken cancellationToken)
    {
        var updated = await _db.Devices
            .Where(d => d.Id == deviceId && d.OrganizationId == organizationId && d.Version == expectedVersion)
            .ExecuteUpdateAsync(
                setters =>
                {
                    setters.SetProperty(d => d.Version, d => d.Version + 1);
                    setters.SetProperty(d => d.UpdatedAt, DateTime.UtcNow);
                    if (clearModelCoordinates)
                    {
                        setters.SetProperty(d => d.X, (double?)null);
                        setters.SetProperty(d => d.Y, (double?)null);
                        setters.SetProperty(d => d.Z, (double?)null);
                    }

                    foreach (var (field, value) in fields)
                    {
                        switch (field)
                        {
                            case "name":
                                setters.SetProperty(d => d.Name, ChangesetValues.AsString(value)!);
                                break;
                            case "category":
                                setters.SetProperty(
                                    d => d.Category,
                                    DeviceCategoryLabels.TryParse(ChangesetValues.AsString(value))!.Value);
                                break;
                            case "networkId":
                                setters.SetProperty(d => d.NetworkId, ChangesetValues.AsString(value)!);
                                break;
                            case "propertyId":
                                setters.SetProperty(d => d.PropertyId, ChangesetValues.AsString(value)!);
                                break;
                            case "roleCode":
                                setters.SetProperty(d => d.RoleCode, ChangesetValues.AsString(value));
                                break;
                            case "latitude":
                                setters.SetProperty(d => d.Latitude, ChangesetValues.AsDouble(value));
                                break;
                            case "longitude":
                                setters.SetProperty(d => d.Longitude, ChangesetValues.AsDouble(value));
                                break;
                            case "floor":
                                setters.SetProperty(d => d.Floor, ChangesetValues.AsInt32(value));
                                break;
                            case "floorLabel":
                                setters.SetProperty(d => d.FloorLabel, ChangesetValues.AsString(value));
                                break;
                            case "ipAddress":
                                setters.SetProperty(d => d.IpAddress, ChangesetValues.AsString(value));
                                break;
                            case "macAddress":
                                setters.SetProperty(d => d.MacAddress, ChangesetValues.AsString(value));
                                break;
                            case "notes":
                                setters.SetProperty(d => d.Notes, ChangesetValues.AsString(value));
                                break;
                            default:
                                throw new ArgumentOutOfRangeException(nameof(fields), field, "not a writable Device field");
                        }
                    }
                },
                cancellationToken);
        return updated == 0 ? null : await FindAsync(organizationId, deviceId, null, cancellationToken);
    }

    public async Task<DeviceRecord?> SetPositionAsync(
        string organizationId,
        string deviceId,
        double? x,
        double? y,
        double? z,
        DerivedLocation? location,
        CancellationToken cancellationToken)
    {
        var updated = await _db.Devices
            .Where(d => d.Id == deviceId && d.OrganizationId == organizationId)
            .ExecuteUpdateAsync(
                setters =>
                {
                    setters.SetProperty(d => d.X, x);
                    setters.SetProperty(d => d.Y, y);
                    setters.SetProperty(d => d.Z, z);
                    setters.SetProperty(d => d.Version, d => d.Version + 1);
                    setters.SetProperty(d => d.UpdatedAt, DateTime.UtcNow);
                    if (location is not null)
                    {
                        setters.SetProperty(d => d.Latitude, location.Latitude);
                        setters.SetProperty(d => d.Longitude, location.Longitude);
                    }
                },
                cancellationToken);
        return updated == 0 ? null : await FindAsync(organizationId, deviceId, null, cancellationToken);
    }

    public async Task<IReadOnlyList<DeviceRecord>> ListPlacedAsync(
        string organizationId,
        IReadOnlyCollection<string> propertyIds,
        CancellationToken cancellationToken)
    {
        var rows = await _db.Devices
            .Where(d => d.OrganizationId == organizationId
                && propertyIds.Contains(d.PropertyId)
                && d.X != null && d.Y != null && d.Z != null)
            .OrderByDescending(d => d.CreatedAt)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
        return [.. rows.Select(ToRecord)];
    }

    public async Task<DeviceRecord?> SetDerivedLocationAsync(
        string organizationId,
        string deviceId,
        double latitude,
        double longitude,
        CancellationToken cancellationToken)
    {
        var updated = await _db.Devices
            .Where(d => d.Id == deviceId && d.OrganizationId == organizationId)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(d => d.Latitude, latitude)
                    .SetProperty(d => d.Longitude, longitude)
                    .SetProperty(d => d.Version, d => d.Version + 1)
                    .SetProperty(d => d.UpdatedAt, DateTime.UtcNow),
                cancellationToken);
        return updated == 0 ? null : await FindAsync(organizationId, deviceId, null, cancellationToken);
    }

    public async Task<DeviceRecord?> SetIfcLinkAsync(
        string organizationId,
        string deviceId,
        string? ifcGlobalId,
        CancellationToken cancellationToken)
    {
        var updated = await _db.Devices
            .Where(d => d.Id == deviceId && d.OrganizationId == organizationId)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(d => d.IfcGlobalId, ifcGlobalId)
                    .SetProperty(d => d.Version, d => d.Version + 1)
                    .SetProperty(d => d.UpdatedAt, DateTime.UtcNow),
                cancellationToken);
        return updated == 0 ? null : await FindAsync(organizationId, deviceId, null, cancellationToken);
    }

    public Task DeleteAsync(string organizationId, string deviceId, CancellationToken cancellationToken) =>
        _db.Devices
            .Where(d => d.Id == deviceId && d.OrganizationId == organizationId)
            .ExecuteDeleteAsync(cancellationToken);

    public Task<bool> NameExistsAsync(
        string organizationId,
        string name,
        string? excludeDeviceId,
        CancellationToken cancellationToken)
    {
        var pattern = SqlPattern.EscapeLike(name);
        return _db.Devices.AnyAsync(
            d => d.OrganizationId == organizationId
                && EF.Functions.ILike(d.Name, pattern)
                && (excludeDeviceId == null || d.Id != excludeDeviceId),
            cancellationToken);
    }

    private IQueryable<DeviceRow> ScopedQuery(string organizationId, IReadOnlyCollection<string>? scope)
    {
        var query = _db.Devices.Where(d => d.OrganizationId == organizationId);
        return scope is null ? query : query.Where(d => scope.Contains(d.PropertyId));
    }

    internal static DeviceRecord ToRecord(DeviceRow row) => new(
        row.Id, row.OrganizationId, row.UserId, row.NetworkId, row.PropertyId, row.RoleCode, row.Name,
        row.Category, row.Latitude, row.Longitude, row.Floor, row.FloorLabel, row.X, row.Y, row.Z,
        row.IfcGlobalId, row.IpAddress, row.MacAddress, row.Notes, row.Version, row.CreatedAt, row.UpdatedAt);
}
