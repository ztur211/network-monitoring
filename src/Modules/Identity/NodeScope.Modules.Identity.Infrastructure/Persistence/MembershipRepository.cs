using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Identity.Application.Membership;
using NodeScope.Modules.Identity.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Identity.Infrastructure.Persistence;

internal sealed class MembershipRepository : IMembershipRepository
{
    private readonly IdentityDbContext _db;

    public MembershipRepository(IdentityDbContext db)
    {
        _db = db;
    }

    public async Task<OrganizationMemberSummary?> FindMembershipByUserAsync(
        string userId,
        CancellationToken cancellationToken)
    {
        var row = await _db.OrganizationMembers
            .AsNoTracking()
            .SingleOrDefaultAsync(m => m.UserId == userId, cancellationToken);
        return row is null
            ? null
            : new OrganizationMemberSummary(row.Id, row.OrganizationId, IdentityLabels.Of(row.Role));
    }

    public async Task<string> CreateMemberAsync(
        string organizationId,
        string userId,
        string role,
        CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var row = new OrganizationMemberRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = organizationId,
            UserId = userId,
            Role = IdentityLabels.TryParseRole(role)
                ?? throw ApiErrors.Validation(["role must be one of the following values: OWNER, ADMIN, MEMBER"]),
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.OrganizationMembers.Add(row);
        await _db.SaveChangesAsync(cancellationToken);
        return row.Id;
    }

    public Task<bool> OrganizationExistsAsync(string organizationId, CancellationToken cancellationToken) =>
        _db.Organizations.AnyAsync(o => o.Id == organizationId, cancellationToken);

    public async Task<string> CreateOrganizationAsync(string name, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var row = new OrganizationRow
        {
            Id = Guid.NewGuid().ToString(),
            Name = name,
            NamingMaxLen = 63,
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.Organizations.Add(row);
        await _db.SaveChangesAsync(cancellationToken);
        return row.Id;
    }

    public async Task<string?> FindOrganizationByDomainAsync(string domain, CancellationToken cancellationToken) =>
        await _db.OrganizationDomains
            .Where(d => d.Domain == domain)
            .Select(d => d.OrganizationId)
            .SingleOrDefaultAsync(cancellationToken);

    public async Task AddDomainAsync(string organizationId, string domain, CancellationToken cancellationToken)
    {
        _db.OrganizationDomains.Add(new OrganizationDomainRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = organizationId,
            Domain = domain,
            CreatedAt = DateTime.UtcNow,
        });
        await _db.SaveChangesAsync(cancellationToken);
    }

    public async Task<UserSummary?> FindUserByEmailAsync(string email, CancellationToken cancellationToken) =>
        await _db.Users
            .Where(u => u.Email == email)
            .Select(u => new UserSummary(u.Id, u.Email))
            .SingleOrDefaultAsync(cancellationToken);

    public async Task<string?> UserEmailAsync(string userId, CancellationToken cancellationToken) =>
        await _db.Users.Where(u => u.Id == userId).Select(u => u.Email).SingleOrDefaultAsync(cancellationToken);

    public Task DeletePendingInvitationsAsync(
        string organizationId,
        string email,
        CancellationToken cancellationToken) =>
        _db.Invitations
            .Where(i => i.OrganizationId == organizationId && i.Email == email && i.AcceptedAt == null)
            .ExecuteDeleteAsync(cancellationToken);

    public async Task<InvitationRecord> CreateInvitationAsync(
        string organizationId,
        string email,
        string role,
        string token,
        DateTime expiresAt,
        string invitedByUserId,
        CancellationToken cancellationToken)
    {
        var row = new InvitationRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = organizationId,
            Email = email,
            Role = IdentityLabels.TryParseRole(role)
                ?? throw ApiErrors.Validation(["role must be one of the following values: OWNER, ADMIN, MEMBER"]),
            Token = token,
            ExpiresAt = expiresAt,
            InvitedByUserId = invitedByUserId,
            CreatedAt = DateTime.UtcNow,
        };
        _db.Invitations.Add(row);
        await _db.SaveChangesAsync(cancellationToken);
        return ToRecord(row);
    }

    public async Task<IReadOnlyList<InvitationRecord>> ListPendingInvitationsAsync(
        string organizationId,
        CancellationToken cancellationToken)
    {
        var rows = await _db.Invitations
            .Where(i => i.OrganizationId == organizationId && i.AcceptedAt == null)
            .OrderByDescending(i => i.CreatedAt)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
        return [.. rows.Select(ToRecord)];
    }

    public async Task<bool> DeleteInvitationAsync(
        string organizationId,
        string invitationId,
        CancellationToken cancellationToken) =>
        await _db.Invitations
            .Where(i => i.Id == invitationId && i.OrganizationId == organizationId)
            .ExecuteDeleteAsync(cancellationToken) > 0;

    public async Task<InvitationRecord?> FindInvitationByTokenAsync(
        string token,
        CancellationToken cancellationToken)
    {
        var row = await _db.Invitations.AsNoTracking().SingleOrDefaultAsync(i => i.Token == token, cancellationToken);
        return row is null ? null : ToRecord(row);
    }

    public Task MarkInvitationAcceptedAsync(string invitationId, CancellationToken cancellationToken) =>
        _db.Invitations
            .Where(i => i.Id == invitationId)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(i => i.AcceptedAt, DateTime.UtcNow), cancellationToken);

    public async Task<JoinRequestRecord?> FindPendingJoinRequestAsync(
        string userId,
        CancellationToken cancellationToken)
    {
        var row = await _db.JoinRequests
            .AsNoTracking()
            .FirstOrDefaultAsync(r => r.UserId == userId && r.Status == JoinRequestStatus.Pending, cancellationToken);
        return row is null ? null : ToRecord(row);
    }

    public async Task<JoinRequestRecord> CreateJoinRequestAsync(
        string organizationId,
        string userId,
        CancellationToken cancellationToken)
    {
        var row = new JoinRequestRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = organizationId,
            UserId = userId,
            Status = JoinRequestStatus.Pending,
            CreatedAt = DateTime.UtcNow,
        };
        _db.JoinRequests.Add(row);
        await _db.SaveChangesAsync(cancellationToken);
        return ToRecord(row);
    }

    public async Task<IReadOnlyList<JoinRequestRecord>> ListJoinRequestsAsync(
        string organizationId,
        string status,
        CancellationToken cancellationToken)
    {
        var parsed = IdentityLabels.TryParseJoinRequestStatus(status)
            ?? throw ApiErrors.Validation(["status must be one of the following values: PENDING, APPROVED, DENIED"]);
        var rows = await _db.JoinRequests
            .Where(r => r.OrganizationId == organizationId && r.Status == parsed)
            .OrderByDescending(r => r.CreatedAt)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
        return [.. rows.Select(ToRecord)];
    }

    public async Task<JoinRequestRecord?> FindJoinRequestAsync(
        string organizationId,
        string joinRequestId,
        CancellationToken cancellationToken)
    {
        var row = await _db.JoinRequests
            .AsNoTracking()
            .SingleOrDefaultAsync(
                r => r.Id == joinRequestId && r.OrganizationId == organizationId, cancellationToken);
        return row is null ? null : ToRecord(row);
    }

    public Task DecideJoinRequestAsync(
        string joinRequestId,
        string status,
        string decidedByUserId,
        CancellationToken cancellationToken)
    {
        var parsed = IdentityLabels.TryParseJoinRequestStatus(status)
            ?? throw ApiErrors.Validation(["status must be one of the following values: PENDING, APPROVED, DENIED"]);
        return _db.JoinRequests
            .Where(r => r.Id == joinRequestId)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(r => r.Status, parsed)
                    .SetProperty(r => r.DecidedByUserId, decidedByUserId)
                    .SetProperty(r => r.DecidedAt, DateTime.UtcNow),
                cancellationToken);
    }

    private static InvitationRecord ToRecord(InvitationRow row) => new(
        row.Id, row.OrganizationId, row.Email, IdentityLabels.Of(row.Role), row.ExpiresAt, row.AcceptedAt,
        row.CreatedAt);

    private static JoinRequestRecord ToRecord(JoinRequestRow row) => new(
        row.Id, row.OrganizationId, row.UserId, IdentityLabels.Of(row.Status), row.CreatedAt, row.DecidedAt);
}
