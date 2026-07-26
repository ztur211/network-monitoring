using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Identity.Application.Organizations;
using NodeScope.Modules.Identity.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Identity.Infrastructure.Persistence;

internal sealed class OrganizationRepository : IOrganizationRepository
{
    private readonly IdentityDbContext _db;

    public OrganizationRepository(IdentityDbContext db)
    {
        _db = db;
    }

    public async Task<OrganizationRecord?> FindAsync(string organizationId, CancellationToken cancellationToken)
    {
        var row = await _db.Organizations
            .AsNoTracking()
            .SingleOrDefaultAsync(o => o.Id == organizationId, cancellationToken);
        return row is null ? null : ToRecord(row);
    }

    public async Task<IReadOnlyList<OrganizationMemberRecord>> ListMembersAsync(
        string organizationId,
        CancellationToken cancellationToken)
    {
        var rows = await (
            from member in _db.OrganizationMembers
            join user in _db.Users on member.UserId equals user.Id
            where member.OrganizationId == organizationId
            orderby member.CreatedAt
            select new { Member = member, user.Email, user.Name })
            .AsNoTracking()
            .ToListAsync(cancellationToken);
        return
        [
            .. rows.Select(row => new OrganizationMemberRecord(
                row.Member.Id,
                row.Member.UserId,
                row.Member.OrganizationId,
                IdentityLabels.Of(row.Member.Role),
                row.Member.CreatedAt,
                row.Email,
                row.Name)),
        ];
    }

    public async Task<OrganizationMemberRecord?> FindMemberAsync(
        string organizationId,
        string userId,
        CancellationToken cancellationToken)
    {
        var row = await _db.OrganizationMembers
            .AsNoTracking()
            .SingleOrDefaultAsync(
                m => m.OrganizationId == organizationId && m.UserId == userId, cancellationToken);
        return row is null ? null : ToRecord(row);
    }

    public Task<int> CountOwnersAsync(string organizationId, CancellationToken cancellationToken) =>
        _db.OrganizationMembers.CountAsync(
            m => m.OrganizationId == organizationId && m.Role == OrgRole.Owner, cancellationToken);

    public async Task<OrganizationRecord?> UpdateWithVersionAsync(
        string organizationId,
        IReadOnlyDictionary<string, JsonElement> fields,
        int expectedVersion,
        CancellationToken cancellationToken)
    {
        var updated = await _db.Organizations
            .Where(o => o.Id == organizationId && o.Version == expectedVersion)
            .ExecuteUpdateAsync(
                setters =>
                {
                    setters.SetProperty(o => o.Version, o => o.Version + 1);
                    setters.SetProperty(o => o.UpdatedAt, DateTime.UtcNow);
                    foreach (var (field, value) in fields)
                    {
                        switch (field)
                        {
                            case "name":
                                setters.SetProperty(o => o.Name, ChangesetValues.AsString(value)!);
                                break;
                            case "namingPattern":
                                setters.SetProperty(o => o.NamingPattern, ChangesetValues.AsString(value));
                                break;
                            case "namingMaxLen":
                                setters.SetProperty(o => o.NamingMaxLen, ChangesetValues.AsInt32(value));
                                break;
                            case "namingTemplate":
                                setters.SetProperty(o => o.NamingTemplate, ChangesetValues.AsString(value));
                                break;
                            default:
                                throw new ArgumentOutOfRangeException(
                                    nameof(fields), field, "not a writable Organization field");
                        }
                    }
                },
                cancellationToken);
        return updated == 0 ? null : await FindAsync(organizationId, cancellationToken);
    }

    public Task UpdateMemberRoleAsync(
        string organizationId,
        string userId,
        string role,
        CancellationToken cancellationToken)
    {
        var next = IdentityLabels.TryParseRole(role)
            ?? throw ApiErrors.Validation(["role must be one of the following values: OWNER, ADMIN, MEMBER"]);
        return _db.OrganizationMembers
            .Where(m => m.OrganizationId == organizationId && m.UserId == userId)
            .ExecuteUpdateAsync(setters => setters.SetProperty(m => m.Role, next), cancellationToken);
    }

    public Task DeleteMemberAsync(string organizationId, string userId, CancellationToken cancellationToken) =>
        _db.OrganizationMembers
            .Where(m => m.OrganizationId == organizationId && m.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);

    private static OrganizationRecord ToRecord(OrganizationRow row) => new(
        row.Id, row.Name, row.NamingPattern, row.NamingMaxLen, row.NamingTemplate, row.Version,
        row.CreatedAt, row.UpdatedAt);

    private static OrganizationMemberRecord ToRecord(OrganizationMemberRow row) => new(
        row.Id, row.UserId, row.OrganizationId, IdentityLabels.Of(row.Role), row.CreatedAt);
}
