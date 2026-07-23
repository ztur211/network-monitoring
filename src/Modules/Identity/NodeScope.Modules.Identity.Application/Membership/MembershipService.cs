using System.Security.Cryptography;
using Microsoft.Extensions.Configuration;
using NodeScope.Contracts.Realtime;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Identity.Application.Membership;

/// <summary>
/// How people get into an organization: invitations, domain-matched join requests, and the
/// super-admin provisioning that bootstraps an org in the first place. There is deliberately
/// no self-service "create my organization" - that is what makes the seeding path a
/// super-admin operation.
/// </summary>
public sealed class MembershipService
{
    private static readonly TimeSpan InvitationLifetime = TimeSpan.FromDays(7);

    private readonly IMembershipRepository _repo;
    private readonly Organizations.IOrganizationRepository _organizations;
    private readonly IRealtimeService _realtime;
    private readonly string _frontendUrl;

    public MembershipService(
        IMembershipRepository repo,
        Organizations.IOrganizationRepository organizations,
        IRealtimeService realtime,
        IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        _repo = repo;
        _organizations = organizations;
        _realtime = realtime;
        _frontendUrl = configuration["FRONTEND_URL"] ?? "http://localhost:8081";
    }

    public async Task<Organizations.OrganizationDto> ProvisionOrganizationAsync(
        string name,
        CancellationToken cancellationToken)
    {
        var id = await _repo.CreateOrganizationAsync(name, cancellationToken);
        var organization = await _organizations.FindAsync(id, cancellationToken)
            ?? throw IdentityErrors.OrganizationNotFound();
        return organization.ToDto();
    }

    public async Task AddDomainAsync(string organizationId, string domain, CancellationToken cancellationToken)
    {
        // The claim check comes first: a domain belongs to exactly one organization, and
        // reporting the clash matters more than whether this org exists.
        if (await _repo.FindOrganizationByDomainAsync(domain, cancellationToken) is not null)
        {
            throw new ApiException("ORG_004", "DOMAIN_ALREADY_CLAIMED", 409);
        }

        if (!await _repo.OrganizationExistsAsync(organizationId, cancellationToken))
        {
            throw IdentityErrors.OrganizationNotFound();
        }

        await _repo.AddDomainAsync(organizationId, domain, cancellationToken);
    }

    /// <summary>
    /// Makes an existing, org-less user the organization's OWNER. It requires an existing user
    /// because there is no way to create one outside sign-up.
    /// </summary>
    public async Task<Organizations.OrganizationMemberDto> DesignateOwnerAsync(
        string organizationId,
        string email,
        CancellationToken cancellationToken)
    {
        if (!await _repo.OrganizationExistsAsync(organizationId, cancellationToken))
        {
            throw IdentityErrors.OrganizationNotFound();
        }

        var user = await _repo.FindUserByEmailAsync(email, cancellationToken)
            ?? throw new ApiException("ORG_001", "USER_NOT_FOUND", 404);
        if (await _repo.FindMembershipByUserAsync(user.Id, cancellationToken) is not null)
        {
            throw new ApiException("ORG_003", "USER_ALREADY_IN_ORG", 409);
        }

        var memberId = await _repo.CreateMemberAsync(
            organizationId, user.Id, OrgRoleNames.Owner, cancellationToken);
        return new Organizations.OrganizationMemberDto(
            memberId, user.Id, organizationId, OrgRoleNames.Owner, DateTime.UtcNow);
    }

    public async Task<CreatedInvitationDto> CreateInvitationAsync(
        OrgMemberContext actor,
        string invitedByUserId,
        CreateInvitationRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(request);
        if (actor.Role == OrgRoleNames.Member)
        {
            throw ApiErrors.ForbiddenRole();
        }

        // An ADMIN may only bring in MEMBERs; inviting at a higher role would let them
        // manufacture the authority they lack.
        if (actor.Role != OrgRoleNames.Owner && request.Role != OrgRoleNames.Member)
        {
            throw new ApiException("PERM_003", "CANNOT_MANAGE_TARGET", 403);
        }

        var email = request.NormalizedEmail;
        await _repo.DeletePendingInvitationsAsync(actor.OrganizationId, email, cancellationToken);

        var token = Base64Url(RandomNumberGenerator.GetBytes(32));
        var invitation = await _repo.CreateInvitationAsync(
            actor.OrganizationId,
            email,
            request.Role!,
            token,
            DateTime.UtcNow + InvitationLifetime,
            invitedByUserId,
            cancellationToken);

        await _realtime.PushToOrgAsync(
            actor.OrganizationId,
            WsEvents.OrgInvitationCreated,
            new { id = invitation.Id, email },
            cancellationToken);
        return new CreatedInvitationDto(invitation.ToDto(), token, $"{_frontendUrl}/invite/{token}");
    }

    public async Task<IReadOnlyList<InvitationDto>> ListInvitationsAsync(
        OrgMemberContext actor,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var invitations = await _repo.ListPendingInvitationsAsync(actor.OrganizationId, cancellationToken);
        return [.. invitations.Select(invitation => invitation.ToDto())];
    }

    public async Task RevokeInvitationAsync(
        OrgMemberContext actor,
        string invitationId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        if (!await _repo.DeleteInvitationAsync(actor.OrganizationId, invitationId, cancellationToken))
        {
            throw InvitationInvalid();
        }

        await _realtime.PushToOrgAsync(
            actor.OrganizationId,
            WsEvents.OrgInvitationRevoked,
            new { id = invitationId },
            cancellationToken);
    }

    /// <summary>
    /// Redeems an invitation for the signed-in user. The address must match the one invited -
    /// otherwise a leaked link would be a free pass into someone else's organization.
    /// </summary>
    public async Task AcceptInvitationAsync(
        string userId,
        string token,
        CancellationToken cancellationToken)
    {
        var invitation = await _repo.FindInvitationByTokenAsync(token, cancellationToken);
        if (invitation is null || invitation.AcceptedAt is not null || invitation.ExpiresAt < DateTime.UtcNow)
        {
            throw InvitationInvalid();
        }

        var email = await _repo.UserEmailAsync(userId, cancellationToken) ?? "";
        if (!string.Equals(invitation.Email, email.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            throw new ApiException("ORG_010", "INVITATION_EMAIL_MISMATCH", 403);
        }

        if (await _repo.FindMembershipByUserAsync(userId, cancellationToken) is not null)
        {
            throw AlreadyAMember();
        }

        await _repo.CreateMemberAsync(invitation.OrganizationId, userId, invitation.Role, cancellationToken);
        await _repo.MarkInvitationAcceptedAsync(invitation.Id, cancellationToken);

        await _realtime.PushToOrgAsync(
            invitation.OrganizationId,
            WsEvents.OrgMemberAdded,
            new { userId, role = invitation.Role },
            cancellationToken);
        await _realtime.PushToOrgAsync(
            invitation.OrganizationId,
            WsEvents.OrgInvitationAccepted,
            new { id = invitation.Id, userId },
            cancellationToken);
    }

    /// <summary>
    /// Asks to join the organization that has claimed the user's email domain. The response
    /// carries no id on purpose: the requester is not a member and has nothing to poll.
    /// </summary>
    public async Task SubmitJoinRequestAsync(string userId, CancellationToken cancellationToken)
    {
        if (await _repo.FindMembershipByUserAsync(userId, cancellationToken) is not null)
        {
            throw AlreadyAMember();
        }

        var email = await _repo.UserEmailAsync(userId, cancellationToken) ?? "";
#pragma warning disable CA1308 // Domains are stored lowercased; matching must use the same case.
        var domain = email.Split('@').ElementAtOrDefault(1)?.ToLowerInvariant() ?? "";
#pragma warning restore CA1308
        var organizationId = await _repo.FindOrganizationByDomainAsync(domain, cancellationToken)
            ?? throw new ApiException("ORG_014", "NO_MATCHING_ORG_FOR_DOMAIN", 404);

        if (await _repo.FindPendingJoinRequestAsync(userId, cancellationToken) is not null)
        {
            throw new ApiException("ORG_015", "DUPLICATE_JOIN_REQUEST", 409);
        }

        var request = await _repo.CreateJoinRequestAsync(organizationId, userId, cancellationToken);
        await _realtime.PushToOrgAsync(
            organizationId,
            WsEvents.OrgJoinRequestCreated,
            new { id = request.Id, userId },
            cancellationToken);
    }

    public async Task<IReadOnlyList<JoinRequestDto>> ListJoinRequestsAsync(
        OrgMemberContext actor,
        string? status,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var requests = await _repo.ListJoinRequestsAsync(
            actor.OrganizationId, string.IsNullOrEmpty(status) ? "PENDING" : status, cancellationToken);
        return [.. requests.Select(request => request.ToDto())];
    }

    public async Task DecideJoinRequestAsync(
        OrgMemberContext actor,
        string joinRequestId,
        bool approve,
        string deciderUserId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var request = await _repo.FindJoinRequestAsync(actor.OrganizationId, joinRequestId, cancellationToken);
        if (request is null || request.Status != "PENDING")
        {
            // An unknown request and an already-decided one are the same answer: there is
            // nothing here left to decide.
            throw new ApiException("ORG_012", "JOIN_REQUEST_INVALID", 404);
        }

        if (approve)
        {
            if (await _repo.FindMembershipByUserAsync(request.UserId, cancellationToken) is not null)
            {
                throw AlreadyAMember();
            }

            await _repo.CreateMemberAsync(
                actor.OrganizationId, request.UserId, OrgRoleNames.Member, cancellationToken);
            await _realtime.PushToOrgAsync(
                actor.OrganizationId,
                WsEvents.OrgMemberAdded,
                new { userId = request.UserId, role = OrgRoleNames.Member },
                cancellationToken);
        }

        await _repo.DecideJoinRequestAsync(
            joinRequestId, approve ? "APPROVED" : "DENIED", deciderUserId, cancellationToken);
        await _realtime.PushToOrgAsync(
            actor.OrganizationId,
            WsEvents.OrgJoinRequestDecided,
            new { id = joinRequestId, approved = approve },
            cancellationToken);
    }

    /// <summary>Unpadded base64url, the shape Node's <c>randomBytes(32).toString('base64url')</c> produces.</summary>
    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static ApiException InvitationInvalid() => new("ORG_009", "INVITATION_INVALID", 404);

    private static ApiException AlreadyAMember() => new("ORG_011", "ALREADY_A_MEMBER", 409);
}
