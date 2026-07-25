using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Identity.Application.Permissions;
using NodeScope.Modules.Identity.Domain;
using NodeScope.Platform.Abstractions;
using Npgsql;

namespace NodeScope.Modules.Identity.Infrastructure.Persistence;

internal sealed class PermissionsRepository : IPermissionsRepository
{
    /// <summary>Postgres' unique-violation SQLSTATE, the signal behind every idempotent write here.</summary>
    private const string UniqueViolation = "23505";

    private readonly IdentityDbContext _db;

    public PermissionsRepository(IdentityDbContext db)
    {
        _db = db;
    }

    public async Task<IReadOnlyList<TeamRecord>> ListVisibleTeamsAsync(
        string organizationId,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken)
    {
        var query = _db.Teams.Where(t => t.OrganizationId == organizationId);
        if (scope is not null)
        {
            query = query.Where(t => _db.TeamProperties.Any(
                tp => tp.TeamId == t.Id && scope.Contains(tp.PropertyId)));
        }

        var rows = await query.OrderBy(t => t.CreatedAt).AsNoTracking().ToListAsync(cancellationToken);
        return [.. rows.Select(ToRecord)];
    }

    public async Task<TeamRecord?> FindTeamAsync(
        string organizationId,
        string teamId,
        CancellationToken cancellationToken)
    {
        var row = await _db.Teams
            .AsNoTracking()
            .SingleOrDefaultAsync(t => t.Id == teamId && t.OrganizationId == organizationId, cancellationToken);
        return row is null ? null : ToRecord(row);
    }

    public async Task<TeamRecord?> CreateTeamAsync(
        string organizationId,
        string name,
        string creatorMemberId,
        CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var row = new TeamRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = organizationId,
            Name = name,
            CreatorMemberId = creatorMemberId,
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.Teams.Add(row);
        try
        {
            await _db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            _db.Teams.Remove(row);
            return null;
        }

        return ToRecord(row);
    }

    public async Task<TeamRenameOutcome> RenameTeamAsync(
        string organizationId,
        string teamId,
        string name,
        int expectedVersion,
        CancellationToken cancellationToken)
    {
        try
        {
            var updated = await _db.Teams
                .Where(t => t.Id == teamId && t.OrganizationId == organizationId && t.Version == expectedVersion)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(t => t.Name, name)
                        .SetProperty(t => t.Version, t => t.Version + 1)
                        .SetProperty(t => t.UpdatedAt, DateTime.UtcNow),
                    cancellationToken);
            return updated == 0 ? TeamRenameOutcome.VersionConflict : TeamRenameOutcome.Renamed;
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            return TeamRenameOutcome.NameTaken;
        }
        catch (PostgresException exception) when (exception.SqlState == UniqueViolation)
        {
            return TeamRenameOutcome.NameTaken;
        }
    }

    public Task DeleteTeamAsync(string organizationId, string teamId, CancellationToken cancellationToken) =>
        _db.Teams
            .Where(t => t.Id == teamId && t.OrganizationId == organizationId)
            .ExecuteDeleteAsync(cancellationToken);

    public async Task<IReadOnlyList<string>> TeamPropertyIdsAsync(
        string organizationId,
        string teamId,
        CancellationToken cancellationToken) =>
        await _db.TeamProperties
            .Where(tp => tp.OrganizationId == organizationId && tp.TeamId == teamId)
            .Select(tp => tp.PropertyId)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<string>> TeamMemberUserIdsAsync(
        string organizationId,
        string teamId,
        CancellationToken cancellationToken) =>
        await _db.TeamMembers
            .Where(tm => tm.OrganizationId == organizationId && tm.TeamId == teamId)
            .Join(
                _db.OrganizationMembers,
                tm => tm.MemberId,
                member => member.Id,
                (_, member) => member.UserId)
            .ToListAsync(cancellationToken);

    public async Task<OrgMemberContext?> FindMemberByIdAsync(
        string organizationId,
        string memberId,
        CancellationToken cancellationToken)
    {
        var row = await _db.OrganizationMembers
            .AsNoTracking()
            .SingleOrDefaultAsync(m => m.Id == memberId && m.OrganizationId == organizationId, cancellationToken);
        return row is null ? null : new OrgMemberContext(row.Id, row.OrganizationId, IdentityLabels.Of(row.Role));
    }

    public async Task<string?> MemberUserIdAsync(
        string organizationId,
        string memberId,
        CancellationToken cancellationToken) =>
        await _db.OrganizationMembers
            .Where(m => m.Id == memberId && m.OrganizationId == organizationId)
            .Select(m => m.UserId)
            .SingleOrDefaultAsync(cancellationToken);

    public async Task<string?> FindTeamMemberAsync(
        string organizationId,
        string teamId,
        string memberId,
        CancellationToken cancellationToken) =>
        await _db.TeamMembers
            .Where(tm => tm.OrganizationId == organizationId && tm.TeamId == teamId && tm.MemberId == memberId)
            .Select(tm => tm.Id)
            .SingleOrDefaultAsync(cancellationToken);

    public async Task<string> AddTeamMemberAsync(
        string organizationId,
        string teamId,
        string memberId,
        CancellationToken cancellationToken)
    {
        var row = new TeamMemberRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = organizationId,
            TeamId = teamId,
            MemberId = memberId,
        };
        return await AddOrExistingAsync(
            row,
            () => FindTeamMemberAsync(organizationId, teamId, memberId, cancellationToken),
            cancellationToken);
    }

    public Task RemoveTeamMemberAsync(
        string organizationId,
        string teamId,
        string memberId,
        CancellationToken cancellationToken) =>
        _db.TeamMembers
            .Where(tm => tm.OrganizationId == organizationId && tm.TeamId == teamId && tm.MemberId == memberId)
            .ExecuteDeleteAsync(cancellationToken);

    public async Task<string?> FindTeamPropertyAsync(
        string organizationId,
        string teamId,
        string propertyId,
        CancellationToken cancellationToken) =>
        await _db.TeamProperties
            .Where(tp => tp.OrganizationId == organizationId && tp.TeamId == teamId && tp.PropertyId == propertyId)
            .Select(tp => tp.Id)
            .SingleOrDefaultAsync(cancellationToken);

    public async Task<string> AddTeamPropertyAsync(
        string organizationId,
        string teamId,
        string propertyId,
        CancellationToken cancellationToken)
    {
        var row = new TeamPropertyRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = organizationId,
            TeamId = teamId,
            PropertyId = propertyId,
        };
        return await AddOrExistingAsync(
            row,
            () => FindTeamPropertyAsync(organizationId, teamId, propertyId, cancellationToken),
            cancellationToken);
    }

    public Task RemoveTeamPropertyAsync(
        string organizationId,
        string teamId,
        string propertyId,
        CancellationToken cancellationToken) =>
        _db.TeamProperties
            .Where(tp => tp.OrganizationId == organizationId && tp.TeamId == teamId && tp.PropertyId == propertyId)
            .ExecuteDeleteAsync(cancellationToken);

    public async Task<string?> FindMemberPropertyAsync(
        string organizationId,
        string memberId,
        string propertyId,
        CancellationToken cancellationToken) =>
        await _db.MemberProperties
            .Where(mp => mp.OrganizationId == organizationId
                && mp.MemberId == memberId
                && mp.PropertyId == propertyId)
            .Select(mp => mp.Id)
            .SingleOrDefaultAsync(cancellationToken);

    public async Task<string> AddMemberPropertyAsync(
        string organizationId,
        string memberId,
        string propertyId,
        CancellationToken cancellationToken)
    {
        var row = new MemberPropertyRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = organizationId,
            MemberId = memberId,
            PropertyId = propertyId,
        };
        return await AddOrExistingAsync(
            row,
            () => FindMemberPropertyAsync(organizationId, memberId, propertyId, cancellationToken),
            cancellationToken);
    }

    public Task RemoveMemberPropertyAsync(
        string organizationId,
        string memberId,
        string propertyId,
        CancellationToken cancellationToken) =>
        _db.MemberProperties
            .Where(mp => mp.OrganizationId == organizationId
                && mp.MemberId == memberId
                && mp.PropertyId == propertyId)
            .ExecuteDeleteAsync(cancellationToken);

    /// <summary>
    /// Inserts an association, treating a unique violation as "someone else just made it" and
    /// returning the existing row's id. These endpoints are idempotent by contract, and the
    /// check-then-insert alone would lose the race.
    /// </summary>
    private async Task<string> AddOrExistingAsync<TRow>(
        TRow row,
        Func<Task<string?>> findExisting,
        CancellationToken cancellationToken)
        where TRow : class, IAssociationRow
    {
        _db.Add(row);
        try
        {
            await _db.SaveChangesAsync(cancellationToken);
            return row.Id;
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            _db.Remove(row);
            // No existing row means the violation was something else entirely.
            return await findExisting()
                ?? throw new InvalidOperationException("Association insert conflicted with no matching row", exception);
        }
    }

    private static bool IsUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException { SqlState: UniqueViolation };

    private static TeamRecord ToRecord(TeamRow row) => new(
        row.Id, row.OrganizationId, row.Name, row.CreatorMemberId, row.Version, row.CreatedAt, row.UpdatedAt);
}
