using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Inventory.Application.Devices;
using NodeScope.Modules.Inventory.Application.Links;
using NodeScope.Modules.Inventory.Application.Map;

namespace NodeScope.Modules.Inventory.Infrastructure.Persistence;

/// <summary>
/// The map's PostGIS reads. <c>Device.location</c> is a <c>geometry(Point, 4326)</c> column
/// maintained by a database trigger from lat/lng and is not mapped, so the spatial predicate
/// stays in SQL while the scope, floor, and ordering compose on top as ordinary LINQ - EF wraps
/// the raw query as a subquery, so nothing ever materializes the geometry.
/// </summary>
internal sealed class MapRepository : IMapRepository
{
    private readonly InventoryDbContext _db;

    public MapRepository(InventoryDbContext db)
    {
        _db = db;
    }

    public async Task<IReadOnlyList<DeviceRecord>> DevicesInBboxAsync(
        string organizationId,
        Bbox bbox,
        int? floor,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(bbox);
        var query = _db.Devices.FromSql(
            $"""
            SELECT * FROM "Device" d
            WHERE d."organizationId" = {organizationId}
              AND d.location IS NOT NULL
              AND ST_Within(
                d.location,
                ST_MakeEnvelope({bbox.West}, {bbox.South}, {bbox.East}, {bbox.North}, 4326))
            """);
        if (floor is not null)
        {
            query = query.Where(d => d.Floor == floor);
        }

        if (scope is not null)
        {
            query = query.Where(d => scope.Contains(d.PropertyId));
        }

        var rows = await query
            .OrderByDescending(d => d.CreatedAt)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
        return [.. rows.Select(DeviceRepository.ToRecord)];
    }

    public async Task<IReadOnlyList<FiberRunRecord>> FiberRunsInBboxAsync(
        string organizationId,
        Bbox bbox,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(bbox);
        var query = _db.FiberRuns.FromSql(
            $"""
            SELECT DISTINCT fr.* FROM "FiberRun" fr
            JOIN "Device" d1 ON fr."startDeviceId" = d1.id
            JOIN "Device" d2 ON fr."endDeviceId" = d2.id
            WHERE fr."organizationId" = {organizationId}
              AND ((d1.location IS NOT NULL
                    AND ST_Within(
                      d1.location,
                      ST_MakeEnvelope({bbox.West}, {bbox.South}, {bbox.East}, {bbox.North}, 4326)))
                OR (d2.location IS NOT NULL
                    AND ST_Within(
                      d2.location,
                      ST_MakeEnvelope({bbox.West}, {bbox.South}, {bbox.East}, {bbox.North}, 4326))))
            """);
        if (scope is not null)
        {
            query = query.Where(fr =>
                _db.Devices.Any(d => d.Id == fr.StartDeviceId && scope.Contains(d.PropertyId))
                || _db.Devices.Any(d => d.Id == fr.EndDeviceId && scope.Contains(d.PropertyId)));
        }

        var rows = await query
            .OrderByDescending(fr => fr.CreatedAt)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
        return [.. rows.Select(FiberRunRepository.ToRecord)];
    }

    public async Task<IReadOnlyList<CircuitRecord>> CircuitsInBboxAsync(
        string organizationId,
        Bbox bbox,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(bbox);
        var query = _db.Circuits.FromSql(
            $"""
            SELECT c.* FROM "Circuit" c
            JOIN "Device" d ON c."deviceId" = d.id
            WHERE c."organizationId" = {organizationId}
              AND d.location IS NOT NULL
              AND ST_Within(
                d.location,
                ST_MakeEnvelope({bbox.West}, {bbox.South}, {bbox.East}, {bbox.North}, 4326))
            """);
        if (scope is not null)
        {
            query = query.Where(c => _db.Devices.Any(d => d.Id == c.DeviceId && scope.Contains(d.PropertyId)));
        }

        var rows = await query
            .OrderByDescending(c => c.CreatedAt)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
        return [.. rows.Select(CircuitRepository.ToRecord)];
    }
}
