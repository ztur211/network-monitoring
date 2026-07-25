using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Identity.Infrastructure.Persistence;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Identity.Infrastructure.Auth;

/// <summary>
/// The single membership lookup, shared by the session authentication handler (per request)
/// and the realtime hub (per connection).
/// </summary>
internal sealed class OrgMembershipResolver : IOrgMembershipResolver
{
    private readonly IdentityDbContext _db;

    public OrgMembershipResolver(IdentityDbContext db)
    {
        _db = db;
    }

    public async Task<OrgMemberContext?> ForUserAsync(string userId, CancellationToken cancellationToken)
    {
        // role::text sidesteps the Postgres enum until the full Identity model (with proper
        // enum mapping) lands alongside the module's endpoints.
        var member = await _db.Database
            .SqlQuery<OrgMemberQueryRow>(
                $"""
                SELECT "id" AS "MemberId", "organizationId" AS "OrganizationId", "role"::text AS "Role"
                FROM "OrganizationMember"
                WHERE "userId" = {userId}
                """)
            .SingleOrDefaultAsync(cancellationToken);
        return member is null
            ? null
            : new OrgMemberContext(member.MemberId, member.OrganizationId, member.Role);
    }

    private sealed record OrgMemberQueryRow(string MemberId, string OrganizationId, string Role);
}
