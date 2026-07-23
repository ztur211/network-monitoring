using NodeScope.Contracts.Realtime;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Identity.Application.Permissions;

/// <summary>
/// Teams, member site grants, and the access read (Node's <c>PermissionsService</c>). The
/// delegation rules are the point of this class: an ADMIN may only hand out access they
/// already hold, and may only manage MEMBERs.
/// </summary>
public sealed class PermissionsService
{
    private readonly IPermissionsRepository _repo;
    private readonly IPermissionScopeService _scope;
    private readonly IRealtimeService _realtime;
    private readonly IAuditService _audit;

    public PermissionsService(
        IPermissionsRepository repo,
        IPermissionScopeService scope,
        IRealtimeService realtime,
        IAuditService audit)
    {
        _repo = repo;
        _scope = scope;
        _realtime = realtime;
        _audit = audit;
    }

    public async Task<AccessSummaryDto> AccessSummaryAsync(
        OrgMemberContext member,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var roots = await _scope.EffectiveRootPropertyIdsAsync(member, cancellationToken);
        return new AccessSummaryDto(member.Role, roots ?? [], roots is null);
    }

    /// <summary>
    /// A target's access as the ACTOR sees it: an OWNER sees every root the target holds, an
    /// ADMIN only the part inside their own scope - they cannot learn about access they could
    /// not have granted.
    /// </summary>
    public async Task<AccessSummaryDto> MemberAccessAsync(
        OrgMemberContext actor,
        string memberId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var target = await RequireMemberAsync(actor.OrganizationId, memberId, cancellationToken);
        AssertCanManageMember(actor, target);

        var roots = await _scope.EffectiveRootPropertyIdsAsync(target, cancellationToken) ?? [];
        if (actor.Role == OrgRoleNames.Owner)
        {
            return new AccessSummaryDto(target.Role, roots, false);
        }

        var actorScope = await _scope.ScopePropertyIdsAsync(actor, cancellationToken) ?? [];
        return new AccessSummaryDto(
            target.Role,
            [.. roots.Where(root => actorScope.Contains(root, StringComparer.Ordinal))],
            false);
    }

    public async Task<IReadOnlyList<TeamDto>> ListTeamsAsync(
        OrgMemberContext member,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var scope = await _scope.ScopePropertyIdsAsync(member, cancellationToken);
        var teams = await _repo.ListVisibleTeamsAsync(member.OrganizationId, scope, cancellationToken);
        return [.. teams.Select(team => team.ToDto())];
    }

    public async Task<TeamDto> CreateTeamAsync(
        OrgMemberContext actor,
        CreateTeamRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(request);
        if (actor.Role == OrgRoleNames.Member)
        {
            throw ApiErrors.ForbiddenRole();
        }

        var team = await _repo.CreateTeamAsync(
            actor.OrganizationId, request.Name!, actor.MemberId, cancellationToken)
            ?? throw TeamNameTaken();
        await _audit.RecordCreateAsync(actor.OrganizationId, "Team", team.Id, team.ToDto(), cancellationToken);

        // A new team has no sites, so the empty list addresses the owner group alone.
        await _realtime.EmitScopedMultiAsync(
            actor.OrganizationId, [], WsEvents.TeamCreated, new { id = team.Id }, cancellationToken);
        return team.ToDto();
    }

    public async Task<TeamDto> RenameTeamAsync(
        OrgMemberContext actor,
        string teamId,
        UpdateTeamRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(request);
        var team = await RequireTeamAsync(actor.OrganizationId, teamId, cancellationToken);
        var sites = await _repo.TeamPropertyIdsAsync(actor.OrganizationId, teamId, cancellationToken);
        await AssertCanManageTeamStructureAsync(actor, team, sites, cancellationToken);

        var outcome = await _repo.RenameTeamAsync(
            actor.OrganizationId, teamId, request.Name!, request.BaseVersion!.Value, cancellationToken);
        if (outcome == TeamRenameOutcome.NameTaken)
        {
            throw TeamNameTaken();
        }

        if (outcome == TeamRenameOutcome.VersionConflict)
        {
            throw Changesets.EditConflict();
        }

        var updated = await RequireTeamAsync(actor.OrganizationId, teamId, cancellationToken);
        await _audit.RecordUpdateAsync(
            actor.OrganizationId,
            "Team",
            teamId,
            [new AuditFieldChange("name", team.Name, request.Name)],
            cancellationToken);
        await _realtime.EmitScopedMultiAsync(
            actor.OrganizationId, sites, WsEvents.TeamUpdated, new { id = teamId }, cancellationToken);
        return updated.ToDto();
    }

    public async Task DeleteTeamAsync(OrgMemberContext actor, string teamId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var team = await RequireTeamAsync(actor.OrganizationId, teamId, cancellationToken);
        var sites = await _repo.TeamPropertyIdsAsync(actor.OrganizationId, teamId, cancellationToken);
        await AssertCanManageTeamStructureAsync(actor, team, sites, cancellationToken);

        // Captured before the delete: afterwards there is nobody left to notify.
        var userIds = await _repo.TeamMemberUserIdsAsync(actor.OrganizationId, teamId, cancellationToken);
        await _repo.DeleteTeamAsync(actor.OrganizationId, teamId, cancellationToken);
        await _audit.RecordDeleteAsync(actor.OrganizationId, "Team", teamId, team.ToDto(), cancellationToken);
        await _realtime.EmitScopedMultiAsync(
            actor.OrganizationId, sites, WsEvents.TeamDeleted, new { id = teamId }, cancellationToken);
        await NotifyAccessChangedAsync(actor.OrganizationId, userIds, cancellationToken);
    }

    public async Task<TeamMemberDto> AddTeamMemberAsync(
        OrgMemberContext actor,
        string teamId,
        string memberId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        _ = await RequireTeamAsync(actor.OrganizationId, teamId, cancellationToken);
        var sites = await _repo.TeamPropertyIdsAsync(actor.OrganizationId, teamId, cancellationToken);
        await AssertCanManageTeamMembershipAsync(actor, sites, cancellationToken);
        var target = await RequireMemberAsync(actor.OrganizationId, memberId, cancellationToken);
        AssertCanManageMember(actor, target);

        // Idempotent: an existing association is returned as-is, with its original id.
        if (await _repo.FindTeamMemberAsync(actor.OrganizationId, teamId, memberId, cancellationToken) is { } existing)
        {
            return new TeamMemberDto(existing, teamId, memberId);
        }

        var id = await _repo.AddTeamMemberAsync(actor.OrganizationId, teamId, memberId, cancellationToken);
        var dto = new TeamMemberDto(id, teamId, memberId);
        await _audit.RecordCreateAsync(actor.OrganizationId, "TeamMember", id, dto, cancellationToken);
        await _realtime.EmitScopedMultiAsync(
            actor.OrganizationId, sites, WsEvents.TeamMemberAdded, new { teamId, memberId }, cancellationToken);
        await NotifyMemberAccessChangedAsync(actor.OrganizationId, memberId, cancellationToken);
        return dto;
    }

    public async Task RemoveTeamMemberAsync(
        OrgMemberContext actor,
        string teamId,
        string memberId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        _ = await RequireTeamAsync(actor.OrganizationId, teamId, cancellationToken);
        var sites = await _repo.TeamPropertyIdsAsync(actor.OrganizationId, teamId, cancellationToken);
        await AssertCanManageTeamMembershipAsync(actor, sites, cancellationToken);
        if (await _repo.FindMemberByIdAsync(actor.OrganizationId, memberId, cancellationToken) is { } target)
        {
            AssertCanManageMember(actor, target);
        }

        await _repo.RemoveTeamMemberAsync(actor.OrganizationId, teamId, memberId, cancellationToken);
        await _realtime.EmitScopedMultiAsync(
            actor.OrganizationId, sites, WsEvents.TeamMemberRemoved, new { teamId, memberId }, cancellationToken);
        await NotifyMemberAccessChangedAsync(actor.OrganizationId, memberId, cancellationToken);
    }

    public async Task<TeamPropertyDto> AssignSiteToTeamAsync(
        OrgMemberContext actor,
        string teamId,
        string propertyId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var team = await RequireTeamAsync(actor.OrganizationId, teamId, cancellationToken);
        var sites = await _repo.TeamPropertyIdsAsync(actor.OrganizationId, teamId, cancellationToken);
        await AssertCanManageTeamStructureAsync(actor, team, sites, cancellationToken);
        await AssertWithinGrantorScopeAsync(actor, [propertyId], cancellationToken);

        if (await _repo.FindTeamPropertyAsync(actor.OrganizationId, teamId, propertyId, cancellationToken) is { } existing)
        {
            return new TeamPropertyDto(existing, teamId, propertyId);
        }

        var userIds = await _repo.TeamMemberUserIdsAsync(actor.OrganizationId, teamId, cancellationToken);
        var id = await _repo.AddTeamPropertyAsync(actor.OrganizationId, teamId, propertyId, cancellationToken);
        var dto = new TeamPropertyDto(id, teamId, propertyId);
        await _audit.RecordCreateAsync(actor.OrganizationId, "TeamProperty", id, dto, cancellationToken);
        await _realtime.EmitScopedMultiAsync(
            actor.OrganizationId,
            [.. sites.Append(propertyId)],
            WsEvents.TeamPropertyAssigned,
            new { teamId, propertyId },
            cancellationToken);
        await NotifyAccessChangedAsync(actor.OrganizationId, userIds, cancellationToken);
        return dto;
    }

    public async Task UnassignSiteFromTeamAsync(
        OrgMemberContext actor,
        string teamId,
        string propertyId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var team = await RequireTeamAsync(actor.OrganizationId, teamId, cancellationToken);
        var sites = await _repo.TeamPropertyIdsAsync(actor.OrganizationId, teamId, cancellationToken);
        await AssertCanManageTeamStructureAsync(actor, team, sites, cancellationToken);

        var userIds = await _repo.TeamMemberUserIdsAsync(actor.OrganizationId, teamId, cancellationToken);
        await _repo.RemoveTeamPropertyAsync(actor.OrganizationId, teamId, propertyId, cancellationToken);
        await _realtime.EmitScopedMultiAsync(
            actor.OrganizationId,
            sites,
            WsEvents.TeamPropertyUnassigned,
            new { teamId, propertyId },
            cancellationToken);
        await NotifyAccessChangedAsync(actor.OrganizationId, userIds, cancellationToken);
    }

    public async Task<MemberPropertyDto> GrantSiteAsync(
        OrgMemberContext actor,
        string memberId,
        string propertyId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var target = await RequireMemberAsync(actor.OrganizationId, memberId, cancellationToken);
        AssertCanManageMember(actor, target);
        await AssertWithinGrantorScopeAsync(actor, [propertyId], cancellationToken);

        if (await _repo.FindMemberPropertyAsync(actor.OrganizationId, memberId, propertyId, cancellationToken)
            is { } existing)
        {
            return new MemberPropertyDto(existing, memberId, propertyId);
        }

        var id = await _repo.AddMemberPropertyAsync(actor.OrganizationId, memberId, propertyId, cancellationToken);
        var dto = new MemberPropertyDto(id, memberId, propertyId);
        await _audit.RecordCreateAsync(actor.OrganizationId, "MemberProperty", id, dto, cancellationToken);
        await _realtime.EmitScopedAsync(
            actor.OrganizationId,
            propertyId,
            WsEvents.MemberPropertyAssigned,
            new { memberId, propertyId },
            cancellationToken);
        await NotifyMemberAccessChangedAsync(actor.OrganizationId, memberId, cancellationToken);
        return dto;
    }

    public async Task RevokeSiteAsync(
        OrgMemberContext actor,
        string memberId,
        string propertyId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        if (await _repo.FindMemberByIdAsync(actor.OrganizationId, memberId, cancellationToken) is { } target)
        {
            AssertCanManageMember(actor, target);
        }

        // Revocation is bounded by the actor's own scope too: they may only take back what
        // they could have given.
        await AssertWithinGrantorScopeAsync(actor, [propertyId], cancellationToken);
        await _repo.RemoveMemberPropertyAsync(actor.OrganizationId, memberId, propertyId, cancellationToken);
        await _realtime.EmitScopedAsync(
            actor.OrganizationId,
            propertyId,
            WsEvents.MemberPropertyUnassigned,
            new { memberId, propertyId },
            cancellationToken);
        await NotifyMemberAccessChangedAsync(actor.OrganizationId, memberId, cancellationToken);
    }

    /// <summary>An OWNER manages anyone; an ADMIN only MEMBERs.</summary>
    private static void AssertCanManageMember(OrgMemberContext actor, OrgMemberContext target)
    {
        if (actor.Role == OrgRoleNames.Owner
            || (actor.Role == OrgRoleNames.Admin && target.Role == OrgRoleNames.Member))
        {
            return;
        }

        throw new ApiException("PERM_003", "CANNOT_MANAGE_TARGET", 403);
    }

    /// <summary>Structure (rename, delete, sites): an ADMIN must have created the team AND hold every site.</summary>
    private async Task AssertCanManageTeamStructureAsync(
        OrgMemberContext actor,
        TeamRecord team,
        IReadOnlyList<string> teamPropertyIds,
        CancellationToken cancellationToken)
    {
        if (actor.Role == OrgRoleNames.Owner)
        {
            return;
        }

        if (actor.Role != OrgRoleNames.Admin || team.CreatorMemberId != actor.MemberId)
        {
            throw new ApiException("PERM_003", "CANNOT_MANAGE_TARGET", 403);
        }

        await AssertWithinGrantorScopeAsync(actor, teamPropertyIds, cancellationToken);
    }

    /// <summary>Membership: an ADMIN needs every one of the team's sites, creator or not.</summary>
    private async Task AssertCanManageTeamMembershipAsync(
        OrgMemberContext actor,
        IReadOnlyList<string> teamPropertyIds,
        CancellationToken cancellationToken)
    {
        if (actor.Role == OrgRoleNames.Owner)
        {
            return;
        }

        if (actor.Role != OrgRoleNames.Admin)
        {
            throw new ApiException("PERM_003", "CANNOT_MANAGE_TARGET", 403);
        }

        foreach (var propertyId in teamPropertyIds)
        {
            if (!await _scope.IsInScopeAsync(actor, propertyId, cancellationToken))
            {
                throw new ApiException("PERM_003", "CANNOT_MANAGE_TARGET", 403);
            }
        }
    }

    /// <summary>Nobody may delegate access they do not hold.</summary>
    private async Task AssertWithinGrantorScopeAsync(
        OrgMemberContext actor,
        IReadOnlyList<string> propertyIds,
        CancellationToken cancellationToken)
    {
        if (actor.Role == OrgRoleNames.Owner)
        {
            return;
        }

        foreach (var propertyId in propertyIds)
        {
            if (!await _scope.IsInScopeAsync(actor, propertyId, cancellationToken))
            {
                throw new ApiException("PERM_002", "SCOPE_EXCEEDS_GRANTOR", 403);
            }
        }
    }

    private async Task NotifyMemberAccessChangedAsync(
        string organizationId,
        string memberId,
        CancellationToken cancellationToken)
    {
        if (await _repo.MemberUserIdAsync(organizationId, memberId, cancellationToken) is { } userId)
        {
            await _realtime.NotifyAccessChangedAsync(organizationId, userId, cancellationToken);
        }
    }

    private async Task NotifyAccessChangedAsync(
        string organizationId,
        IReadOnlyList<string> userIds,
        CancellationToken cancellationToken)
    {
        foreach (var userId in userIds)
        {
            await _realtime.NotifyAccessChangedAsync(organizationId, userId, cancellationToken);
        }
    }

    private async Task<TeamRecord> RequireTeamAsync(
        string organizationId,
        string teamId,
        CancellationToken cancellationToken) =>
        await _repo.FindTeamAsync(organizationId, teamId, cancellationToken)
        ?? throw new ApiException("TEAM_001", "TEAM_NOT_FOUND", 404);

    private async Task<OrgMemberContext> RequireMemberAsync(
        string organizationId,
        string memberId,
        CancellationToken cancellationToken) =>
        await _repo.FindMemberByIdAsync(organizationId, memberId, cancellationToken)
        ?? throw new ApiException("ORG_001", "NOT_A_MEMBER", 404);

    private static ApiException TeamNameTaken() => new("TEAM_002", "TEAM_NAME_TAKEN", 409);
}
