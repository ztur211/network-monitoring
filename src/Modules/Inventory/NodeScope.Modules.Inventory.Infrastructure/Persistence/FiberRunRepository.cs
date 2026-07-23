using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Inventory.Application.Links;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Infrastructure.Persistence;

internal sealed class FiberRunRepository : IFiberRunRepository
{
    private readonly InventoryDbContext _db;

    public FiberRunRepository(InventoryDbContext db)
    {
        _db = db;
    }

    public async Task<IReadOnlyList<FiberRunRecord>> ListVisibleAsync(
        string organizationId,
        IReadOnlyCollection<string>? scope,
        string? deviceId,
        CancellationToken cancellationToken)
    {
        var query = ScopedQuery(organizationId, scope);
        if (deviceId is not null)
        {
            query = query.Where(r => r.StartDeviceId == deviceId || r.EndDeviceId == deviceId);
        }

        var rows = await query
            .OrderByDescending(r => r.CreatedAt)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
        return [.. rows.Select(ToRecord)];
    }

    public async Task<FiberRunRecord?> FindAsync(
        string organizationId,
        string fiberRunId,
        CancellationToken cancellationToken)
    {
        var row = await _db.FiberRuns
            .AsNoTracking()
            .SingleOrDefaultAsync(r => r.Id == fiberRunId && r.OrganizationId == organizationId, cancellationToken);
        return row is null ? null : ToRecord(row);
    }

    public async Task<FiberRunRecord?> FindVisibleAsync(
        string organizationId,
        string fiberRunId,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken)
    {
        var row = await ScopedQuery(organizationId, scope)
            .AsNoTracking()
            .SingleOrDefaultAsync(r => r.Id == fiberRunId, cancellationToken);
        return row is null ? null : ToRecord(row);
    }

    public async Task<FiberRunRecord> CreateAsync(NewFiberRun fiberRun, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(fiberRun);
        var now = DateTime.UtcNow;
        var row = new FiberRunRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = fiberRun.OrganizationId,
            UserId = fiberRun.UserId,
            Name = fiberRun.Name,
            StartDeviceId = fiberRun.StartDeviceId,
            EndDeviceId = fiberRun.EndDeviceId,
            CableType = fiberRun.CableType,
            LengthMeters = fiberRun.LengthMeters,
            Notes = fiberRun.Notes,
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.FiberRuns.Add(row);
        await _db.SaveChangesAsync(cancellationToken);
        return ToRecord(row);
    }

    public async Task<FiberRunRecord?> UpdateWithVersionAsync(
        string organizationId,
        string fiberRunId,
        IReadOnlyDictionary<string, JsonElement> fields,
        int expectedVersion,
        CancellationToken cancellationToken)
    {
        var updated = await _db.FiberRuns
            .Where(r => r.Id == fiberRunId && r.OrganizationId == organizationId && r.Version == expectedVersion)
            .ExecuteUpdateAsync(
                setters =>
                {
                    setters.SetProperty(r => r.Version, r => r.Version + 1);
                    setters.SetProperty(r => r.UpdatedAt, DateTime.UtcNow);
                    foreach (var (field, value) in fields)
                    {
                        switch (field)
                        {
                            case "name":
                                setters.SetProperty(r => r.Name, ChangesetValues.AsString(value)!);
                                break;
                            case "cableType":
                                setters.SetProperty(r => r.CableType, ChangesetValues.AsString(value));
                                break;
                            case "lengthMeters":
                                setters.SetProperty(r => r.LengthMeters, ChangesetValues.AsDouble(value));
                                break;
                            case "notes":
                                setters.SetProperty(r => r.Notes, ChangesetValues.AsString(value));
                                break;
                            default:
                                throw new ArgumentOutOfRangeException(nameof(fields), field, "not a writable FiberRun field");
                        }
                    }
                },
                cancellationToken);
        return updated == 0 ? null : await FindAsync(organizationId, fiberRunId, cancellationToken);
    }

    public Task DeleteAsync(string organizationId, string fiberRunId, CancellationToken cancellationToken) =>
        _db.FiberRuns
            .Where(r => r.Id == fiberRunId && r.OrganizationId == organizationId)
            .ExecuteDeleteAsync(cancellationToken);

    /// <summary>A run is visible when EITHER endpoint device sits in scope.</summary>
    private IQueryable<FiberRunRow> ScopedQuery(string organizationId, IReadOnlyCollection<string>? scope)
    {
        var query = _db.FiberRuns.Where(r => r.OrganizationId == organizationId);
        return scope is null
            ? query
            : query.Where(r => _db.Devices.Any(d => d.Id == r.StartDeviceId && scope.Contains(d.PropertyId))
                || _db.Devices.Any(d => d.Id == r.EndDeviceId && scope.Contains(d.PropertyId)));
    }

    internal static FiberRunRecord ToRecord(FiberRunRow row) => new(
        row.Id, row.OrganizationId, row.UserId, row.Name, row.StartDeviceId, row.EndDeviceId, row.CableType,
        row.LengthMeters, row.Notes, row.Version, row.CreatedAt, row.UpdatedAt);
}
