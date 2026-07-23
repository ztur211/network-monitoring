using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NodeScope.Modules.Inventory.Application.Properties;
using NodeScope.Modules.Inventory.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Infrastructure.Persistence;

/// <summary>
/// EF implementation of <see cref="IPropertyRepository"/>. The two recursive walks are the
/// Node <c>PropertyTreeRepository</c>'s SQL verbatim, Postgres <c>CYCLE</c> guard included:
/// a cyclic tree fails closed (500 <c>PROP_006</c>) because a silently-wrong id set here
/// widens permission scopes.
/// </summary>
internal sealed partial class PropertyRepository : IPropertyRepository
{
    private readonly InventoryDbContext _db;
    private readonly ILogger<PropertyRepository> _logger;

    public PropertyRepository(InventoryDbContext db, ILogger<PropertyRepository> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<PropertyRecord?> FindAsync(
        string organizationId,
        string id,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken)
    {
        var query = _db.Properties.Where(p => p.Id == id && p.OrganizationId == organizationId);
        if (scope is not null)
        {
            query = query.Where(p => scope.Contains(p.Id));
        }

        var row = await query.AsNoTracking().SingleOrDefaultAsync(cancellationToken);
        return row is null ? null : ToRecord(row);
    }

    public async Task<IReadOnlyList<PropertyRecord>> ListAsync(
        string organizationId,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken)
    {
        var query = _db.Properties.Where(p => p.OrganizationId == organizationId);
        if (scope is not null)
        {
            query = query.Where(p => scope.Contains(p.Id));
        }

        var rows = await query.OrderBy(p => p.CreatedAt).AsNoTracking().ToListAsync(cancellationToken);
        return [.. rows.Select(ToRecord)];
    }

    public Task<bool> SiblingNameExistsAsync(
        string organizationId,
        string? parentId,
        string name,
        string? excludeId,
        CancellationToken cancellationToken)
    {
        // Case-insensitive equality via ILIKE with pattern metacharacters escaped,
        // matching Prisma's `mode: 'insensitive'` equals.
        var pattern = name
            .Replace(@"\", @"\\", StringComparison.Ordinal)
            .Replace("%", @"\%", StringComparison.Ordinal)
            .Replace("_", @"\_", StringComparison.Ordinal);
        return _db.Properties.AnyAsync(
            p => p.OrganizationId == organizationId
                && p.ParentId == parentId
                && EF.Functions.ILike(p.Name, pattern)
                && (excludeId == null || p.Id != excludeId),
            cancellationToken);
    }

    public async Task<PropertyRecord> CreateAsync(NewProperty newProperty, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(newProperty);
        var now = DateTime.UtcNow;
        var row = new PropertyRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = newProperty.OrganizationId,
            ParentId = newProperty.ParentId,
            Type = newProperty.Type,
            Name = newProperty.Name,
            Code = newProperty.Code,
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.Properties.Add(row);
        await _db.SaveChangesAsync(cancellationToken);
        return ToRecord(row);
    }

    public async Task<PropertyRecord?> UpdateWithVersionAsync(
        string organizationId,
        string id,
        IReadOnlyDictionary<string, JsonElement> fields,
        int expectedVersion,
        CancellationToken cancellationToken)
    {
        var updated = await _db.Properties
            .Where(p => p.Id == id && p.OrganizationId == organizationId && p.Version == expectedVersion)
            .ExecuteUpdateAsync(
                setters =>
                {
                    setters.SetProperty(p => p.Version, p => p.Version + 1);
                    setters.SetProperty(p => p.UpdatedAt, DateTime.UtcNow);
                    foreach (var (field, value) in fields)
                    {
                        switch (field)
                        {
                            case "name":
                                setters.SetProperty(p => p.Name, ChangesetValues.AsString(value)!);
                                break;
                            case "code":
                                setters.SetProperty(p => p.Code, ChangesetValues.AsString(value));
                                break;
                            case "parentId":
                                setters.SetProperty(p => p.ParentId, ChangesetValues.AsString(value));
                                break;
                            default:
                                throw new ArgumentOutOfRangeException(nameof(fields), field, "not a writable Property field");
                        }
                    }
                },
                cancellationToken);
        return updated == 0 ? null : await FindAsync(organizationId, id, null, cancellationToken);
    }

    public Task DeleteAsync(string organizationId, string id, CancellationToken cancellationToken) =>
        _db.Properties
            .Where(p => p.Id == id && p.OrganizationId == organizationId)
            .ExecuteDeleteAsync(cancellationToken);

    public async Task<IReadOnlyList<string>> SubtreeIdsAsync(
        string organizationId,
        string rootId,
        CancellationToken cancellationToken)
    {
        var rows = await _db.Database
            .SqlQuery<SubtreeRow>(
                $"""
                WITH RECURSIVE subtree AS (
                  SELECT "id" FROM "Property"
                    WHERE "id" = {rootId} AND "organizationId" = {organizationId}
                  UNION ALL
                  SELECT p."id" FROM "Property" p
                    JOIN subtree s ON p."parentId" = s."id" AND p."organizationId" = {organizationId}
                ) CYCLE "id" SET "isCycle" USING "cyclePath"
                SELECT "id" AS "Id", "isCycle" AS "IsCycle" FROM subtree
                """)
            .ToListAsync(cancellationToken);
        AssertAcyclic(rows.Where(r => r.IsCycle).Select(r => r.Id), organizationId, rootId, "subtree");
        return [.. rows.Select(r => r.Id)];
    }

    public async Task<IReadOnlyList<PropertyTreeNode>> AncestorChainAsync(
        string organizationId,
        string id,
        CancellationToken cancellationToken)
    {
        var rows = await _db.Database
            .SqlQuery<AncestorRow>(
                $"""
                WITH RECURSIVE chain AS (
                  SELECT "id", "parentId", "type", "code", 0 AS depth FROM "Property"
                    WHERE "id" = {id} AND "organizationId" = {organizationId}
                  UNION ALL
                  SELECT p."id", p."parentId", p."type", p."code", c.depth + 1 FROM "Property" p
                    JOIN chain c ON p."id" = c."parentId" AND p."organizationId" = {organizationId}
                ) CYCLE "id" SET "isCycle" USING "cyclePath"
                SELECT "id" AS "Id", "type"::text AS "Type", "code" AS "Code", "isCycle" AS "IsCycle"
                FROM chain ORDER BY depth ASC
                """)
            .ToListAsync(cancellationToken);
        AssertAcyclic(rows.Where(r => r.IsCycle).Select(r => r.Id), organizationId, id, "ancestors");
        return [.. rows.Select(r => new PropertyTreeNode(r.Id, PropertyTypeLabels.TryParse(r.Type)!.Value, r.Code))];
    }

    public async Task<IReadOnlyList<string>> AncestorIdsAsync(
        string organizationId,
        string id,
        CancellationToken cancellationToken) =>
        [.. (await AncestorChainAsync(organizationId, id, cancellationToken)).Select(node => node.Id)];

    public async Task<bool> IsAtOrUnderAsync(
        string organizationId,
        string descendantId,
        string ancestorId,
        CancellationToken cancellationToken) =>
        (await AncestorIdsAsync(organizationId, descendantId, cancellationToken))
            .Contains(ancestorId, StringComparer.Ordinal);

    public async Task<IReadOnlyList<PlacedDevice>> DevicesUnderAsync(
        string organizationId,
        IReadOnlyCollection<string> propertyIds,
        CancellationToken cancellationToken)
    {
        if (propertyIds.Count == 0)
        {
            return [];
        }

        return await _db.Devices
            .Where(d => d.OrganizationId == organizationId && propertyIds.Contains(d.PropertyId))
            .Select(d => new PlacedDevice(d.Id, d.NetworkId, d.PropertyId))
            .ToListAsync(cancellationToken);
    }

    public Task<int> CountDevicesUnderAsync(
        string organizationId,
        IReadOnlyCollection<string> propertyIds,
        CancellationToken cancellationToken) =>
        propertyIds.Count == 0
            ? Task.FromResult(0)
            : _db.Devices.CountAsync(
                d => d.OrganizationId == organizationId && propertyIds.Contains(d.PropertyId),
                cancellationToken);

    public Task<int> CountChartersUnderAsync(
        string organizationId,
        IReadOnlyCollection<string> propertyIds,
        CancellationToken cancellationToken) =>
        propertyIds.Count == 0
            ? Task.FromResult(0)
            : _db.NetworkProperties.CountAsync(
                np => np.OrganizationId == organizationId && propertyIds.Contains(np.PropertyId),
                cancellationToken);

    public Task<int> CountBuildingModelsUnderAsync(
        string organizationId,
        IReadOnlyCollection<string> propertyIds,
        CancellationToken cancellationToken) =>
        propertyIds.Count == 0
            ? Task.FromResult(0)
            : _db.BuildingModels.CountAsync(
                m => m.OrganizationId == organizationId && propertyIds.Contains(m.PropertyId),
                cancellationToken);

    public async Task<int> CountAssignmentsUnderAsync(
        string organizationId,
        IReadOnlyCollection<string> propertyIds,
        CancellationToken cancellationToken)
    {
        if (propertyIds.Count == 0)
        {
            return 0;
        }

        var teams = await _db.TeamProperties.CountAsync(
            tp => tp.OrganizationId == organizationId && propertyIds.Contains(tp.PropertyId),
            cancellationToken);
        var members = await _db.MemberProperties.CountAsync(
            mp => mp.OrganizationId == organizationId && propertyIds.Contains(mp.PropertyId),
            cancellationToken);
        return teams + members;
    }

    private void AssertAcyclic(IEnumerable<string> cycleIds, string organizationId, string startId, string direction)
    {
        var repeated = cycleIds.ToList();
        if (repeated.Count == 0)
        {
            return;
        }

        Log.PropertyTreeCycle(_logger, organizationId, startId, direction, string.Join(",", repeated));
        throw new ApiException("PROP_006", "PROPERTY_TREE_CYCLE", 500);
    }

    private static PropertyRecord ToRecord(PropertyRow row) => new(
        row.Id, row.OrganizationId, row.ParentId, row.Type, row.Name, row.Code,
        row.Version, row.CreatedAt, row.UpdatedAt);

    private sealed record SubtreeRow(string Id, bool IsCycle);

    private sealed record AncestorRow(string Id, string Type, string? Code, bool IsCycle);

    private static partial class Log
    {
        [LoggerMessage(
            Level = LogLevel.Error,
            Message = "Property hierarchy contains a cycle; refusing the {Direction} walk "
                + "(org {OrganizationId}, start {StartId}, cycle closes at {CycleIds})")]
        public static partial void PropertyTreeCycle(
            ILogger logger,
            string organizationId,
            string startId,
            string direction,
            string cycleIds);
    }
}
