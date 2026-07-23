using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NodeScope.Modules.Identity.Infrastructure.Persistence;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Identity.Infrastructure.Scope;

/// <summary>
/// F3 scoping, ported from the Node <c>PermissionsService</c> + <c>PropertyTreeRepository</c>.
/// A member's scope is the union of subtrees under their effective roots (team assignments
/// via membership plus direct assignments). The downward walk carries the Postgres
/// <c>CYCLE</c> guard verbatim: a cyclic Property tree must fail closed (500
/// <c>PROP_006</c>), never silently widen a scope - see the Node repository's class comment
/// for the full reasoning.
/// </summary>
/// <remarks>
/// Scoped lifetime doubles as the per-request memoization the Node side implemented with
/// <c>scopeCacheAls</c>: instance fields cache computed scopes for the request.
/// </remarks>
internal sealed partial class PermissionScopeService : IPermissionScopeService
{
    private readonly IdentityDbContext _db;
    private readonly ILogger<PermissionScopeService> _logger;
    private readonly Dictionary<string, IReadOnlyList<string>> _scopeCache = new(StringComparer.Ordinal);

    public PermissionScopeService(IdentityDbContext db, ILogger<PermissionScopeService> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<IReadOnlyList<string>?> ScopePropertyIdsAsync(
        OrgMemberContext member,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        if (member.Role == OrgRoleNames.Owner)
        {
            return null;
        }

        return await ComputeScopeAsync(member, cancellationToken);
    }

    public async Task<bool> IsInScopeAsync(
        OrgMemberContext member,
        string propertyId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        if (member.Role == OrgRoleNames.Owner)
        {
            return true;
        }

        var scope = await ComputeScopeAsync(member, cancellationToken);
        return scope.Contains(propertyId, StringComparer.Ordinal);
    }

    public async Task AssertCanConfigureAsync(
        OrgMemberContext member,
        string governingSitePropertyId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        if (member.Role == OrgRoleNames.Owner)
        {
            return;
        }

        if (member.Role == OrgRoleNames.Member)
        {
            throw ApiErrors.ForbiddenRole();
        }

        if (!await IsInScopeAsync(member, governingSitePropertyId, cancellationToken))
        {
            throw ApiErrors.OutsideAssignedScope();
        }
    }

    public async Task AssertNetworkFullCoverageAsync(
        OrgMemberContext member,
        IReadOnlyCollection<string> propertyIds,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(propertyIds);
        if (member.Role == OrgRoleNames.Owner)
        {
            return;
        }

        if (member.Role == OrgRoleNames.Member)
        {
            throw ApiErrors.ForbiddenRole();
        }

        foreach (var propertyId in propertyIds)
        {
            if (!await IsInScopeAsync(member, propertyId, cancellationToken))
            {
                throw ApiErrors.NetworkPartialScope();
            }
        }
    }

    private async Task<IReadOnlyList<string>> ComputeScopeAsync(
        OrgMemberContext member,
        CancellationToken cancellationToken)
    {
        var key = $"{member.OrganizationId}:{member.MemberId}";
        if (_scopeCache.TryGetValue(key, out var cached))
        {
            return cached;
        }

        var roots = await EffectiveRootPropertyIdsAsync(member, cancellationToken);
        var scope = new HashSet<string>(StringComparer.Ordinal);
        foreach (var root in roots)
        {
            scope.UnionWith(await SubtreePropertyIdsAsync(member.OrganizationId, root, cancellationToken));
        }

        var result = scope.ToList();
        _scopeCache[key] = result;
        return result;
    }

    /// <summary>Union of team-assignment roots (via membership) and direct member roots, deduped.</summary>
    private async Task<List<string>> EffectiveRootPropertyIdsAsync(
        OrgMemberContext member,
        CancellationToken cancellationToken) =>
        await _db.TeamProperties
            .Where(tp => tp.OrganizationId == member.OrganizationId
                && _db.TeamMembers.Any(tm => tm.TeamId == tp.TeamId && tm.MemberId == member.MemberId))
            .Select(tp => tp.PropertyId)
            .Union(_db.MemberProperties
                .Where(mp => mp.OrganizationId == member.OrganizationId && mp.MemberId == member.MemberId)
                .Select(mp => mp.PropertyId))
            .ToListAsync(cancellationToken);

    /// <summary>The property and every descendant (org-scoped), with the cycle guard.</summary>
    private async Task<List<string>> SubtreePropertyIdsAsync(
        string organizationId,
        string rootId,
        CancellationToken cancellationToken)
    {
        var rows = await _db.Database
            .SqlQuery<WalkRow>(
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

        var repeated = rows.Where(row => row.IsCycle).Select(row => row.Id).ToList();
        if (repeated.Count > 0)
        {
            Log.PropertyTreeCycle(_logger, organizationId, rootId, string.Join(",", repeated));
            throw new ApiException("PROP_006", "PROPERTY_TREE_CYCLE", 500);
        }

        return rows.Select(row => row.Id).ToList();
    }

    private sealed record WalkRow(string Id, bool IsCycle);

    private static partial class Log
    {
        [LoggerMessage(
            Level = LogLevel.Error,
            Message = "Property hierarchy contains a cycle; refusing to compute a scope from corrupt data "
                + "(org {OrganizationId}, root {RootId}, cycle closes at {CycleIds})")]
        public static partial void PropertyTreeCycle(ILogger logger, string organizationId, string rootId, string cycleIds);
    }
}
