using System.Text.Json;
using NodeScope.Contracts.Realtime;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Identity.Application.Organizations;

/// <summary>Organization wire DTO, including the device-naming policy Inventory enforces.</summary>
public sealed record OrganizationDto(
    string Id,
    string Name,
    string? NamingPattern,
    int? NamingMaxLen,
    string? NamingTemplate,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public sealed record OrganizationMemberDto(
    string Id,
    string UserId,
    string OrganizationId,
    string Role,
    DateTime CreatedAt,
    string? Email,
    string? Name);

/// <summary>The changeset surface of an Organization (Node's <c>ORG_WRITABLE_FIELDS</c>).</summary>
public static class OrganizationFields
{
    public static readonly IReadOnlyList<string> Writable =
        ["name", "namingPattern", "namingMaxLen", "namingTemplate"];

    public const int MaxChanges = 10;

    public static bool IsValid(string field, JsonElement value) => field switch
    {
        "name" => value.ValueKind == JsonValueKind.String && value.GetString()!.Length is >= 1 and <= 120,
        "namingPattern" or "namingTemplate" => ChangesetValues.IsNullish(value)
            || value.ValueKind == JsonValueKind.String,
        "namingMaxLen" => ChangesetValues.IsNullish(value)
            || (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out _)),
        _ => false,
    };
}

/// <summary>The caller's own organization and its roster (Node's <c>OrganizationsService</c>).</summary>
public sealed class OrganizationsService
{
    private readonly IOrganizationRepository _organizations;
    private readonly IRealtimeService _realtime;

    public OrganizationsService(IOrganizationRepository organizations, IRealtimeService realtime)
    {
        _organizations = organizations;
        _realtime = realtime;
    }

    public async Task<OrganizationDto> GetMineAsync(OrgMemberContext member, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var organization = await _organizations.FindAsync(member.OrganizationId, cancellationToken)
            ?? throw IdentityErrors.OrganizationNotFound();
        return organization.ToDto();
    }

    public async Task<IReadOnlyList<OrganizationMemberDto>> GetMembersAsync(
        OrgMemberContext member,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var members = await _organizations.ListMembersAsync(member.OrganizationId, cancellationToken);
        return [.. members.Select(row => row.ToDto())];
    }

    public async Task<OrganizationDto> UpdateMineAsync(
        OrgMemberContext member,
        ChangesetRequest patch,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(patch);
        var organization = await _organizations.FindAsync(member.OrganizationId, cancellationToken)
            ?? throw IdentityErrors.OrganizationNotFound();

        var payload = Changesets.BuildUpdatePayload(
            patch, OrganizationFields.Writable, organization.Version, OrganizationFields.IsValid);
        var updated = await _organizations.UpdateWithVersionAsync(
            member.OrganizationId, payload, patch.BaseVersion!.Value, cancellationToken)
            ?? throw IdentityErrors.EditConflict();
        return updated.ToDto();
    }

    /// <summary>
    /// Changes a member's role. An ADMIN may only touch MEMBERs and only promote to MEMBER;
    /// the last OWNER cannot be demoted, or the org would be left unadministered.
    /// </summary>
    public async Task ChangeMemberRoleAsync(
        OrgMemberContext actor,
        string targetUserId,
        string nextRole,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var target = await _organizations.FindMemberAsync(actor.OrganizationId, targetUserId, cancellationToken)
            ?? throw NotAnOrgMember();
        AssertCanManage(actor.Role, target.Role, nextRole);

        if (target.Role == OrgRoleNames.Owner
            && nextRole != OrgRoleNames.Owner
            && await _organizations.CountOwnersAsync(actor.OrganizationId, cancellationToken) <= 1)
        {
            throw LastOwnerProtected();
        }

        await _organizations.UpdateMemberRoleAsync(
            actor.OrganizationId, targetUserId, nextRole, cancellationToken);
        await _realtime.PushToOrgAsync(
            actor.OrganizationId,
            WsEvents.OrgMemberUpdated,
            new { userId = targetUserId, role = nextRole, timestamp = IsoTimestamp.Now() },
            cancellationToken);
    }

    public async Task RemoveMemberAsync(
        OrgMemberContext actor,
        string targetUserId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var target = await _organizations.FindMemberAsync(actor.OrganizationId, targetUserId, cancellationToken)
            ?? throw NotAnOrgMember();
        AssertCanManage(actor.Role, target.Role, nextRole: null);

        if (target.Role == OrgRoleNames.Owner
            && await _organizations.CountOwnersAsync(actor.OrganizationId, cancellationToken) <= 1)
        {
            throw LastOwnerProtected();
        }

        await _organizations.DeleteMemberAsync(actor.OrganizationId, targetUserId, cancellationToken);

        // The event goes out before the eviction so the member's live client can react to it,
        // and the eviction follows because a connection's org is fixed at connect time - without
        // it a removed member keeps receiving org broadcasts until they happen to disconnect.
        await _realtime.PushToOrgAsync(
            actor.OrganizationId,
            WsEvents.OrgMemberRemoved,
            new { userId = targetUserId, timestamp = IsoTimestamp.Now() },
            cancellationToken);
        await _realtime.EvictOrgMemberAsync(actor.OrganizationId, targetUserId, cancellationToken);
    }

    /// <summary>An OWNER may manage anyone; an ADMIN only MEMBERs, and only to MEMBER.</summary>
    private static void AssertCanManage(string actorRole, string targetRole, string? nextRole)
    {
        if (actorRole == OrgRoleNames.Owner)
        {
            return;
        }

        var touchesPrivileged = targetRole != OrgRoleNames.Member
            || (nextRole is not null && nextRole != OrgRoleNames.Member);
        if (actorRole != OrgRoleNames.Admin || touchesPrivileged)
        {
            throw ApiErrors.InsufficientOrgRole();
        }
    }

    /// <summary>404, not the 403 the guard uses: the target simply is not in this org.</summary>
    private static ApiException NotAnOrgMember() => new("ORG_002", "NOT_AN_ORG_MEMBER", 404);

    private static ApiException LastOwnerProtected() => new("ORG_013", "LAST_OWNER_PROTECTED", 409);
}

/// <summary>An Organization row as the application layer sees it.</summary>
public sealed record OrganizationRecord(
    string Id,
    string Name,
    string? NamingPattern,
    int? NamingMaxLen,
    string? NamingTemplate,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt)
{
    public OrganizationDto ToDto() => new(
        Id, Name, NamingPattern, NamingMaxLen, NamingTemplate, Version, CreatedAt, UpdatedAt);
}

/// <summary>An OrganizationMember row.</summary>
public sealed record OrganizationMemberRecord(
    string Id,
    string UserId,
    string OrganizationId,
    string Role,
    DateTime CreatedAt,
    string? Email = null,
    string? Name = null)
{
    public OrganizationMemberDto ToDto() => new(
        Id, UserId, OrganizationId, Role, CreatedAt, Email, Name);
}

/// <summary>Organization and membership persistence.</summary>
public interface IOrganizationRepository
{
    public Task<OrganizationRecord?> FindAsync(string organizationId, CancellationToken cancellationToken);

    /// <summary>Ordered by <c>createdAt</c> ascending.</summary>
    public Task<IReadOnlyList<OrganizationMemberRecord>> ListMembersAsync(
        string organizationId,
        CancellationToken cancellationToken);

    public Task<OrganizationMemberRecord?> FindMemberAsync(
        string organizationId,
        string userId,
        CancellationToken cancellationToken);

    public Task<int> CountOwnersAsync(string organizationId, CancellationToken cancellationToken);

    public Task<OrganizationRecord?> UpdateWithVersionAsync(
        string organizationId,
        IReadOnlyDictionary<string, JsonElement> fields,
        int expectedVersion,
        CancellationToken cancellationToken);

    public Task UpdateMemberRoleAsync(
        string organizationId,
        string userId,
        string role,
        CancellationToken cancellationToken);

    public Task DeleteMemberAsync(string organizationId, string userId, CancellationToken cancellationToken);
}

/// <summary>Body of <c>PATCH /api/v1/organizations/me/members/:userId</c>.</summary>
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(
    System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed class ChangeMemberRoleRequest
{
    public string? Role { get; init; }

    public IReadOnlyList<string> Validate() =>
        Role is "OWNER" or "ADMIN" or "MEMBER"
            ? []
            : ["role must be one of the following values: OWNER, ADMIN, MEMBER"];
}
