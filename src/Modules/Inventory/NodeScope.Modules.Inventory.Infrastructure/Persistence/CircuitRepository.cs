using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Inventory.Application.Links;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Infrastructure.Persistence;

internal sealed class CircuitRepository : ICircuitRepository
{
    private readonly InventoryDbContext _db;

    public CircuitRepository(InventoryDbContext db)
    {
        _db = db;
    }

    public async Task<IReadOnlyList<CircuitRecord>> ListPageAsync(
        string organizationId,
        IReadOnlyCollection<string>? scope,
        int take,
        CircuitCursor? cursor,
        CancellationToken cancellationToken)
    {
        var query = ScopedQuery(organizationId, scope);
        if (cursor is not null)
        {
            var createdAt = DateTime.Parse(
                cursor.CreatedAt, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);
            // Postgres performs this comparison, so a .NET StringComparison would change the
            // keyset ordering away from the ORDER BY the database applies (CA1309 assumes an
            // in-process compare).
#pragma warning disable CA1309
            query = query.Where(c =>
                c.CreatedAt < createdAt || (c.CreatedAt == createdAt && string.Compare(c.Id, cursor.Id) < 0));
#pragma warning restore CA1309
        }

        var rows = await query
            .OrderByDescending(c => c.CreatedAt)
            .ThenByDescending(c => c.Id)
            .Take(take)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
        return [.. rows.Select(ToRecord)];
    }

    public Task<int> CountAsync(
        string organizationId,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken) =>
        ScopedQuery(organizationId, scope).CountAsync(cancellationToken);

    public async Task<CircuitRecord?> FindAsync(
        string organizationId,
        string circuitId,
        CancellationToken cancellationToken)
    {
        var row = await _db.Circuits
            .AsNoTracking()
            .SingleOrDefaultAsync(c => c.Id == circuitId && c.OrganizationId == organizationId, cancellationToken);
        return row is null ? null : ToRecord(row);
    }

    public async Task<CircuitRecord?> FindVisibleAsync(
        string organizationId,
        string circuitId,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken)
    {
        var row = await ScopedQuery(organizationId, scope)
            .AsNoTracking()
            .SingleOrDefaultAsync(c => c.Id == circuitId, cancellationToken);
        return row is null ? null : ToRecord(row);
    }

    public async Task<CircuitRecord> CreateAsync(NewCircuit circuit, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(circuit);
        var now = DateTime.UtcNow;
        var row = new CircuitRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = circuit.OrganizationId,
            UserId = circuit.UserId,
            IspName = circuit.IspName,
            CircuitId = circuit.CircuitId,
            ServiceType = circuit.ServiceType,
            Bandwidth = circuit.Bandwidth,
            DeviceId = circuit.DeviceId,
            Notes = circuit.Notes,
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.Circuits.Add(row);
        await _db.SaveChangesAsync(cancellationToken);
        return ToRecord(row);
    }

    public async Task<CircuitRecord?> UpdateWithVersionAsync(
        string organizationId,
        string circuitId,
        IReadOnlyDictionary<string, JsonElement> fields,
        int expectedVersion,
        CancellationToken cancellationToken)
    {
        var updated = await _db.Circuits
            .Where(c => c.Id == circuitId && c.OrganizationId == organizationId && c.Version == expectedVersion)
            .ExecuteUpdateAsync(
                setters =>
                {
                    setters.SetProperty(c => c.Version, c => c.Version + 1);
                    setters.SetProperty(c => c.UpdatedAt, DateTime.UtcNow);
                    foreach (var (field, value) in fields)
                    {
                        switch (field)
                        {
                            case "ispName":
                                setters.SetProperty(c => c.IspName, ChangesetValues.AsString(value)!);
                                break;
                            case "circuitId":
                                setters.SetProperty(c => c.CircuitId, ChangesetValues.AsString(value));
                                break;
                            case "serviceType":
                                setters.SetProperty(c => c.ServiceType, ChangesetValues.AsString(value)!);
                                break;
                            case "bandwidth":
                                setters.SetProperty(c => c.Bandwidth, ChangesetValues.AsDouble(value));
                                break;
                            case "deviceId":
                                setters.SetProperty(c => c.DeviceId, ChangesetValues.AsString(value));
                                break;
                            case "notes":
                                setters.SetProperty(c => c.Notes, ChangesetValues.AsString(value));
                                break;
                            default:
                                throw new ArgumentOutOfRangeException(nameof(fields), field, "not a writable Circuit field");
                        }
                    }
                },
                cancellationToken);
        return updated == 0 ? null : await FindAsync(organizationId, circuitId, cancellationToken);
    }

    public Task DeleteAsync(string organizationId, string circuitId, CancellationToken cancellationToken) =>
        _db.Circuits
            .Where(c => c.Id == circuitId && c.OrganizationId == organizationId)
            .ExecuteDeleteAsync(cancellationToken);

    /// <summary>
    /// Scoped reads join through the linked device, so a scoped member never sees a device-less
    /// circuit - the relation filter cannot match a null <c>deviceId</c>.
    /// </summary>
    private IQueryable<CircuitRow> ScopedQuery(string organizationId, IReadOnlyCollection<string>? scope)
    {
        var query = _db.Circuits.Where(c => c.OrganizationId == organizationId);
        return scope is null
            ? query
            : query.Where(c => _db.Devices.Any(d => d.Id == c.DeviceId && scope.Contains(d.PropertyId)));
    }

    internal static CircuitRecord ToRecord(CircuitRow row) => new(
        row.Id, row.OrganizationId, row.UserId, row.IspName, row.CircuitId, row.ServiceType, row.Bandwidth,
        row.DeviceId, row.Notes, row.Version, row.CreatedAt, row.UpdatedAt);
}
