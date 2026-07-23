using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Inventory.Application.Links;
using NodeScope.Modules.Inventory.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Infrastructure.Persistence;

internal sealed class ConnectionRepository : IConnectionRepository
{
    private readonly InventoryDbContext _db;

    public ConnectionRepository(InventoryDbContext db)
    {
        _db = db;
    }

    public async Task<IReadOnlyList<ConnectionRecord>> ListVisibleAsync(
        string organizationId,
        IReadOnlyCollection<string>? scope,
        string? deviceId,
        CancellationToken cancellationToken)
    {
        var query = ScopedQuery(organizationId, scope);
        if (deviceId is not null)
        {
            query = query.Where(c => c.SourceDeviceId == deviceId || c.TargetDeviceId == deviceId);
        }

        var rows = await query
            .OrderByDescending(c => c.CreatedAt)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
        return [.. rows.Select(ToRecord)];
    }

    public async Task<ConnectionRecord?> FindAsync(
        string organizationId,
        string connectionId,
        CancellationToken cancellationToken)
    {
        var row = await _db.DeviceConnections
            .AsNoTracking()
            .SingleOrDefaultAsync(c => c.Id == connectionId && c.OrganizationId == organizationId, cancellationToken);
        return row is null ? null : ToRecord(row);
    }

    public async Task<ConnectionRecord?> FindVisibleAsync(
        string organizationId,
        string connectionId,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken)
    {
        var row = await ScopedQuery(organizationId, scope)
            .AsNoTracking()
            .SingleOrDefaultAsync(c => c.Id == connectionId, cancellationToken);
        return row is null ? null : ToRecord(row);
    }

    public Task<bool> DuplicateExistsAsync(
        string organizationId,
        string sourceDeviceId,
        string targetDeviceId,
        ConnectionType connectionType,
        CancellationToken cancellationToken) =>
        _db.DeviceConnections.AnyAsync(
            c => c.OrganizationId == organizationId
                && c.SourceDeviceId == sourceDeviceId
                && c.TargetDeviceId == targetDeviceId
                && c.ConnectionType == connectionType,
            cancellationToken);

    public async Task<ConnectionRecord> CreateAsync(NewConnection connection, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(connection);
        var now = DateTime.UtcNow;
        var row = new DeviceConnectionRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = connection.OrganizationId,
            UserId = connection.UserId,
            SourceDeviceId = connection.SourceDeviceId,
            TargetDeviceId = connection.TargetDeviceId,
            ConnectionType = connection.ConnectionType,
            Notes = connection.Notes,
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.DeviceConnections.Add(row);
        await _db.SaveChangesAsync(cancellationToken);
        return ToRecord(row);
    }

    public async Task<ConnectionRecord?> UpdateWithVersionAsync(
        string organizationId,
        string connectionId,
        IReadOnlyDictionary<string, JsonElement> fields,
        int expectedVersion,
        CancellationToken cancellationToken)
    {
        var updated = await _db.DeviceConnections
            .Where(c => c.Id == connectionId && c.OrganizationId == organizationId && c.Version == expectedVersion)
            .ExecuteUpdateAsync(
                setters =>
                {
                    setters.SetProperty(c => c.Version, c => c.Version + 1);
                    setters.SetProperty(c => c.UpdatedAt, DateTime.UtcNow);
                    foreach (var (field, value) in fields)
                    {
                        switch (field)
                        {
                            case "connectionType":
                                setters.SetProperty(
                                    c => c.ConnectionType,
                                    ConnectionTypeLabels.TryParse(ChangesetValues.AsString(value))!.Value);
                                break;
                            case "notes":
                                setters.SetProperty(c => c.Notes, ChangesetValues.AsString(value));
                                break;
                            default:
                                throw new ArgumentOutOfRangeException(
                                    nameof(fields), field, "not a writable DeviceConnection field");
                        }
                    }
                },
                cancellationToken);
        return updated == 0 ? null : await FindAsync(organizationId, connectionId, cancellationToken);
    }

    public Task DeleteAsync(string organizationId, string connectionId, CancellationToken cancellationToken) =>
        _db.DeviceConnections
            .Where(c => c.Id == connectionId && c.OrganizationId == organizationId)
            .ExecuteDeleteAsync(cancellationToken);

    /// <summary>A connection is visible when EITHER endpoint device sits in scope.</summary>
    private IQueryable<DeviceConnectionRow> ScopedQuery(string organizationId, IReadOnlyCollection<string>? scope)
    {
        var query = _db.DeviceConnections.Where(c => c.OrganizationId == organizationId);
        return scope is null
            ? query
            : query.Where(c => _db.Devices.Any(d => d.Id == c.SourceDeviceId && scope.Contains(d.PropertyId))
                || _db.Devices.Any(d => d.Id == c.TargetDeviceId && scope.Contains(d.PropertyId)));
    }

    private static ConnectionRecord ToRecord(DeviceConnectionRow row) => new(
        row.Id, row.OrganizationId, row.UserId, row.SourceDeviceId, row.TargetDeviceId, row.ConnectionType,
        row.Notes, row.Version, row.CreatedAt, row.UpdatedAt);
}
