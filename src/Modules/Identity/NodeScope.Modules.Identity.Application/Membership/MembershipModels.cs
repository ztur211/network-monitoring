using System.Text.Json.Serialization;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Identity.Application.Membership;

/// <summary>An invitation as clients see it. The token never appears here - only in the create response.</summary>
public sealed record InvitationDto(
    string Id,
    string Email,
    string Role,
    DateTime ExpiresAt,
    DateTime? AcceptedAt,
    DateTime CreatedAt);

/// <summary>
/// The create response. The token is revealed exactly once and is pasted into the native
/// client; there is intentionally no browser URL because the appliance has no browser surface.
/// </summary>
public sealed record CreatedInvitationDto(InvitationDto Invitation, string Token);

public sealed record JoinRequestDto(
    string Id,
    string OrganizationId,
    string UserId,
    string Status,
    DateTime CreatedAt,
    DateTime? DecidedAt,
    string? Email,
    string? Name);

/// <summary>Body of <c>POST /api/v1/organizations/me/invitations</c>.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class CreateInvitationRequest
{
    public string? Email { get; init; }

    public string? Role { get; init; }

    /// <summary>
    /// Invitations match on a normalized address, so the same person cannot be invited twice.
    /// Lowercase specifically: that is how the address is stored, so CA1308's uppercase advice
    /// would break the comparison it is meant to make safe.
    /// </summary>
    public string NormalizedEmail =>
#pragma warning disable CA1308
        (Email ?? "").Trim().ToLowerInvariant();
#pragma warning restore CA1308

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        if (Email is null || !Email.Contains('@', StringComparison.Ordinal))
        {
            errors.Add("email must be an email");
        }

        if (Role is not ("OWNER" or "ADMIN" or "MEMBER"))
        {
            errors.Add("role must be one of the following values: OWNER, ADMIN, MEMBER");
        }

        return errors;
    }
}

/// <summary>Body of <c>POST /api/v1/invitations/accept</c>.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class AcceptInvitationRequest
{
    public string? Token { get; init; }

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        RequestValidation.RequireNonEmptyString(errors, Token, "token");
        return errors;
    }
}

/// <summary>
/// Body of the one-time first-organization bootstrap. The installer writes the
/// credential to its mode-0600 environment file and prints it for the operator.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class BootstrapOrganizationRequest
{
    public string? Name { get; init; }

    public string? Token { get; init; }

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        RequestValidation.RequireNonEmptyString(errors, Name, "name");
        RequestValidation.MaxLength(errors, Name, "name", 120);
        RequestValidation.RequireNonEmptyString(errors, Token, "token");
        return errors;
    }
}

/// <summary>Body of <c>POST /api/v1/admin/organizations</c>.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class CreateOrganizationRequest
{
    public string? Name { get; init; }

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        RequestValidation.RequireNonEmptyString(errors, Name, "name");
        RequestValidation.MaxLength(errors, Name, "name", 120);
        return errors;
    }
}

/// <summary>Body of <c>POST /api/v1/admin/organizations/:id/domains</c>.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class AddDomainRequest
{
    public string? Domain { get; init; }

    /// <summary>Domains are stored lowercased, so the claim lookup has to match that (see CA1308 above).</summary>
    public string NormalizedDomain =>
#pragma warning disable CA1308
        (Domain ?? "").Trim().ToLowerInvariant();
#pragma warning restore CA1308

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        RequestValidation.RequireNonEmptyString(errors, Domain, "domain");
        RequestValidation.MaxLength(errors, Domain, "domain", 253);
        return errors;
    }
}

/// <summary>Body of <c>POST /api/v1/admin/organizations/:id/owner</c>.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class DesignateOwnerRequest
{
    public string? Email { get; init; }

    public IReadOnlyList<string> Validate() =>
        Email is not null && Email.Contains('@', StringComparison.Ordinal)
            ? []
            : ["email must be an email"];
}

/// <summary>An Invitation row as the application layer sees it.</summary>
public sealed record InvitationRecord(
    string Id,
    string OrganizationId,
    string Email,
    string Role,
    DateTime ExpiresAt,
    DateTime? AcceptedAt,
    DateTime CreatedAt)
{
    public InvitationDto ToDto() => new(Id, Email, Role, ExpiresAt, AcceptedAt, CreatedAt);
}

/// <summary>A JoinRequest row.</summary>
public sealed record JoinRequestRecord(
    string Id,
    string OrganizationId,
    string UserId,
    string Status,
    DateTime CreatedAt,
    DateTime? DecidedAt,
    string? Email = null,
    string? Name = null)
{
    public JoinRequestDto ToDto() => new(
        Id, OrganizationId, UserId, Status, CreatedAt, DecidedAt, Email, Name);
}

/// <summary>Invitation, join-request, and org-provisioning persistence.</summary>
public interface IMembershipRepository
{
    public Task<OrganizationMemberSummary?> FindMembershipByUserAsync(
        string userId,
        CancellationToken cancellationToken);

    public Task<string> CreateMemberAsync(
        string organizationId,
        string userId,
        string role,
        CancellationToken cancellationToken);

    public Task<bool> OrganizationExistsAsync(string organizationId, CancellationToken cancellationToken);

    public Task<string> CreateOrganizationAsync(string name, CancellationToken cancellationToken);

    /// <summary>
    /// Atomically creates the appliance's first organization and makes the caller its
    /// owner. Returns null once any organization exists or the caller is already a member.
    /// </summary>
    public Task<string?> TryBootstrapOrganizationAsync(
        string userId,
        string name,
        CancellationToken cancellationToken);

    /// <summary>The organization that has claimed the domain, if any (domains are globally unique).</summary>
    public Task<string?> FindOrganizationByDomainAsync(string domain, CancellationToken cancellationToken);

    public Task AddDomainAsync(string organizationId, string domain, CancellationToken cancellationToken);

    public Task<UserSummary?> FindUserByEmailAsync(string email, CancellationToken cancellationToken);

    public Task<string?> UserEmailAsync(string userId, CancellationToken cancellationToken);

    /// <summary>Clears any unaccepted invitation for the address, so re-inviting replaces it.</summary>
    public Task DeletePendingInvitationsAsync(
        string organizationId,
        string email,
        CancellationToken cancellationToken);

    public Task<InvitationRecord> CreateInvitationAsync(
        string organizationId,
        string email,
        string role,
        string token,
        DateTime expiresAt,
        string invitedByUserId,
        CancellationToken cancellationToken);

    /// <summary>Unaccepted invitations, newest first.</summary>
    public Task<IReadOnlyList<InvitationRecord>> ListPendingInvitationsAsync(
        string organizationId,
        CancellationToken cancellationToken);

    /// <summary>False when no invitation matched (unknown or already revoked).</summary>
    public Task<bool> DeleteInvitationAsync(
        string organizationId,
        string invitationId,
        CancellationToken cancellationToken);

    public Task<InvitationRecord?> FindInvitationByTokenAsync(string token, CancellationToken cancellationToken);

    public Task MarkInvitationAcceptedAsync(string invitationId, CancellationToken cancellationToken);

    public Task<JoinRequestRecord?> FindPendingJoinRequestAsync(string userId, CancellationToken cancellationToken);

    public Task<JoinRequestRecord> CreateJoinRequestAsync(
        string organizationId,
        string userId,
        CancellationToken cancellationToken);

    public Task<IReadOnlyList<JoinRequestRecord>> ListJoinRequestsAsync(
        string organizationId,
        string status,
        CancellationToken cancellationToken);

    public Task<JoinRequestRecord?> FindJoinRequestAsync(
        string organizationId,
        string joinRequestId,
        CancellationToken cancellationToken);

    public Task DecideJoinRequestAsync(
        string joinRequestId,
        string status,
        string decidedByUserId,
        CancellationToken cancellationToken);
}

/// <summary>The membership facts other flows need about a user.</summary>
public sealed record OrganizationMemberSummary(string MemberId, string OrganizationId, string Role);

public sealed record UserSummary(string Id, string Email, string? Name);
