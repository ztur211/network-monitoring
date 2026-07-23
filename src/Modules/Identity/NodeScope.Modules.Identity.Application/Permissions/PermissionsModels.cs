using System.Text.Json.Serialization;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Identity.Application.Permissions;

/// <summary>What a member may reach: their roots, or unscoped for an OWNER.</summary>
public sealed record AccessSummaryDto(
    string Role,
    IReadOnlyList<string> AssignedRootPropertyIds,
    bool Unscoped);

public sealed record TeamDto(
    string Id,
    string OrganizationId,
    string Name,
    string? CreatorMemberId,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt);

/// <summary>An association row. Re-creating one returns the SAME id - these are idempotent.</summary>
public sealed record TeamMemberDto(string Id, string TeamId, string MemberId);

public sealed record TeamPropertyDto(string Id, string TeamId, string PropertyId);

public sealed record MemberPropertyDto(string Id, string MemberId, string PropertyId);

/// <summary>Body of <c>POST /api/v1/teams</c>.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class CreateTeamRequest
{
    public string? Name { get; init; }

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        RequestValidation.RequireNonEmptyString(errors, Name, "name");
        RequestValidation.MaxLength(errors, Name, "name", 100);
        return errors;
    }
}

/// <summary>
/// Body of <c>PATCH /api/v1/teams/:id</c>. Flat, not a changeset: the only writable field is
/// the name, and the Node DTO carries the version beside it rather than wrapping it.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class UpdateTeamRequest
{
    public int? BaseVersion { get; init; }

    public string? Name { get; init; }

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        if (BaseVersion is null or < 1)
        {
            errors.Add("baseVersion must not be less than 1");
        }

        RequestValidation.RequireNonEmptyString(errors, Name, "name");
        RequestValidation.MaxLength(errors, Name, "name", 100);
        return errors;
    }
}

/// <summary>Body of <c>POST /api/v1/teams/:id/members</c>.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class AddTeamMemberRequest
{
    public string? MemberId { get; init; }

    public IReadOnlyList<string> Validate() =>
        MemberId is not null && Guid.TryParse(MemberId, out _) ? [] : ["memberId must be a UUID"];
}

/// <summary>Body of <c>POST /api/v1/teams/:id/properties</c> and the member-grant route.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class AddPropertyRequest
{
    public string? PropertyId { get; init; }

    public IReadOnlyList<string> Validate() =>
        PropertyId is not null && Guid.TryParse(PropertyId, out _) ? [] : ["propertyId must be a UUID"];
}

/// <summary>A Team row as the application layer sees it.</summary>
public sealed record TeamRecord(
    string Id,
    string OrganizationId,
    string Name,
    string? CreatorMemberId,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt)
{
    public TeamDto ToDto() => new(Id, OrganizationId, Name, CreatorMemberId, Version, CreatedAt, UpdatedAt);
}

/// <summary>The permission graph's persistence (Node's <c>PermissionsRepository</c>).</summary>
public interface IPermissionsRepository
{
    /// <summary>
    /// Teams visible to the scope, oldest first. A scoped member sees a team only through a
    /// site they can reach, so a site-less team reaches the OWNER alone.
    /// </summary>
    public Task<IReadOnlyList<TeamRecord>> ListVisibleTeamsAsync(
        string organizationId,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken);

    public Task<TeamRecord?> FindTeamAsync(string organizationId, string teamId, CancellationToken cancellationToken);

    /// <summary>Null when the name is already taken in this organization.</summary>
    public Task<TeamRecord?> CreateTeamAsync(
        string organizationId,
        string name,
        string creatorMemberId,
        CancellationToken cancellationToken);

    /// <summary>Version-gated rename; reports the name clash separately from the stale version.</summary>
    public Task<TeamRenameOutcome> RenameTeamAsync(
        string organizationId,
        string teamId,
        string name,
        int expectedVersion,
        CancellationToken cancellationToken);

    public Task DeleteTeamAsync(string organizationId, string teamId, CancellationToken cancellationToken);

    public Task<IReadOnlyList<string>> TeamPropertyIdsAsync(
        string organizationId,
        string teamId,
        CancellationToken cancellationToken);

    /// <summary>User ids of the team's members, for the access-changed notifications.</summary>
    public Task<IReadOnlyList<string>> TeamMemberUserIdsAsync(
        string organizationId,
        string teamId,
        CancellationToken cancellationToken);

    public Task<OrgMemberContext?> FindMemberByIdAsync(
        string organizationId,
        string memberId,
        CancellationToken cancellationToken);

    /// <summary>The user behind an org-member row, for access notifications.</summary>
    public Task<string?> MemberUserIdAsync(
        string organizationId,
        string memberId,
        CancellationToken cancellationToken);

    public Task<string?> FindTeamMemberAsync(
        string organizationId,
        string teamId,
        string memberId,
        CancellationToken cancellationToken);

    public Task<string> AddTeamMemberAsync(
        string organizationId,
        string teamId,
        string memberId,
        CancellationToken cancellationToken);

    public Task RemoveTeamMemberAsync(
        string organizationId,
        string teamId,
        string memberId,
        CancellationToken cancellationToken);

    public Task<string?> FindTeamPropertyAsync(
        string organizationId,
        string teamId,
        string propertyId,
        CancellationToken cancellationToken);

    public Task<string> AddTeamPropertyAsync(
        string organizationId,
        string teamId,
        string propertyId,
        CancellationToken cancellationToken);

    public Task RemoveTeamPropertyAsync(
        string organizationId,
        string teamId,
        string propertyId,
        CancellationToken cancellationToken);

    public Task<string?> FindMemberPropertyAsync(
        string organizationId,
        string memberId,
        string propertyId,
        CancellationToken cancellationToken);

    public Task<string> AddMemberPropertyAsync(
        string organizationId,
        string memberId,
        string propertyId,
        CancellationToken cancellationToken);

    public Task RemoveMemberPropertyAsync(
        string organizationId,
        string memberId,
        string propertyId,
        CancellationToken cancellationToken);
}

/// <summary>Why a rename did or did not happen.</summary>
public enum TeamRenameOutcome
{
    Renamed,
    VersionConflict,
    NameTaken,
}
