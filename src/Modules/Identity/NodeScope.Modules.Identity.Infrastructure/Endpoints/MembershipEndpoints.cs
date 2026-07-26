using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NodeScope.Modules.Identity.Application.Membership;
using NodeScope.Modules.Identity.Infrastructure.Auth;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Identity.Infrastructure.Endpoints;

/// <summary>
/// Getting into an organization: super-admin provisioning, invitations, and join requests
/// (Node's <c>admin-organizations</c>, <c>invitations</c>, <c>invitation-accept</c>,
/// <c>join-request-submit</c>, and <c>join-requests</c> controllers).
/// </summary>
internal static class MembershipEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/api/v1/admin/organizations").RequireSuperAdmin();
        admin.MapPost("", ProvisionOrganizationAsync);
        admin.MapPost("/{id}/domains", AddDomainAsync);
        admin.MapPost("/{id}/owner", DesignateOwnerAsync);

        app.MapPost("/api/v1/bootstrap/organization", BootstrapOrganizationAsync)
            .RequireAuthorization();

        var invitations = app.MapGroup("/api/v1/organizations/me/invitations")
            .RequireOrgRoles(OrgRoleNames.Owner, OrgRoleNames.Admin);
        invitations.MapPost("", CreateInvitationAsync);
        invitations.MapGet("", ListInvitationsAsync);
        invitations.MapDelete("/{id}", RevokeInvitationAsync);

        var joinRequests = app.MapGroup("/api/v1/organizations/me/join-requests")
            .RequireOrgRoles(OrgRoleNames.Owner, OrgRoleNames.Admin);
        joinRequests.MapGet("", ListJoinRequestsAsync);
        joinRequests.MapPost("/{id}/approve", ApproveJoinRequestAsync);
        joinRequests.MapPost("/{id}/deny", DenyJoinRequestAsync);

        // Both of these are reached by someone who is NOT yet in an organization, so they are
        // authenticated only.
        app.MapPost("/api/v1/invitations/accept", AcceptInvitationAsync).RequireAuthorization();
        app.MapPost("/api/v1/join-requests", SubmitJoinRequestAsync).RequireAuthorization();
    }

    private static async Task<IResult> ProvisionOrganizationAsync(
        CreateOrganizationRequest body,
        MembershipService service,
        CancellationToken cancellationToken)
    {
        Validate(body.Validate());
        return ApiEnvelope.Created(await service.ProvisionOrganizationAsync(body.Name!, cancellationToken));
    }

    private static async Task<IResult> AddDomainAsync(
        string id,
        AddDomainRequest body,
        MembershipService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        Validate(body.Validate());
        await service.AddDomainAsync(id, body.NormalizedDomain, cancellationToken);
        return ApiEnvelope.Created(null);
    }

    private static async Task<IResult> BootstrapOrganizationAsync(
        BootstrapOrganizationRequest body,
        ClaimsPrincipal user,
        MembershipService service,
        CancellationToken cancellationToken)
    {
        Validate(body.Validate());
        return ApiEnvelope.Created(await service.BootstrapOrganizationAsync(
            UserId(user), body.Name!.Trim(), body.Token!, cancellationToken));
    }

    private static async Task<IResult> DesignateOwnerAsync(
        string id,
        DesignateOwnerRequest body,
        MembershipService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        Validate(body.Validate());
        return ApiEnvelope.Created(await service.DesignateOwnerAsync(id, body.Email!, cancellationToken));
    }

    private static async Task<IResult> CreateInvitationAsync(
        CreateInvitationRequest body,
        IOrgContextAccessor org,
        ClaimsPrincipal user,
        MembershipService service,
        CancellationToken cancellationToken)
    {
        Validate(body.Validate());
        return ApiEnvelope.Created(
            await service.CreateInvitationAsync(org.OrgMember!, UserId(user), body, cancellationToken));
    }

    private static async Task<IResult> ListInvitationsAsync(
        IOrgContextAccessor org,
        MembershipService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.ListInvitationsAsync(org.OrgMember!, cancellationToken));

    private static async Task<IResult> RevokeInvitationAsync(
        string id,
        IOrgContextAccessor org,
        MembershipService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        await service.RevokeInvitationAsync(org.OrgMember!, id, cancellationToken);
        return ApiEnvelope.Ok(null);
    }

    private static async Task<IResult> AcceptInvitationAsync(
        AcceptInvitationRequest body,
        ClaimsPrincipal user,
        MembershipService service,
        CancellationToken cancellationToken)
    {
        Validate(body.Validate());
        await service.AcceptInvitationAsync(UserId(user), body.Token!, cancellationToken);
        return ApiEnvelope.Created(null);
    }

    private static async Task<IResult> SubmitJoinRequestAsync(
        ClaimsPrincipal user,
        MembershipService service,
        CancellationToken cancellationToken)
    {
        await service.SubmitJoinRequestAsync(UserId(user), cancellationToken);
        return ApiEnvelope.Created(null);
    }

    private static async Task<IResult> ListJoinRequestsAsync(
        string? status,
        IOrgContextAccessor org,
        MembershipService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.ListJoinRequestsAsync(org.OrgMember!, status, cancellationToken));

    private static Task<IResult> ApproveJoinRequestAsync(
        string id,
        IOrgContextAccessor org,
        ClaimsPrincipal user,
        MembershipService service,
        CancellationToken cancellationToken) =>
        DecideAsync(id, approve: true, org, user, service, cancellationToken);

    private static Task<IResult> DenyJoinRequestAsync(
        string id,
        IOrgContextAccessor org,
        ClaimsPrincipal user,
        MembershipService service,
        CancellationToken cancellationToken) =>
        DecideAsync(id, approve: false, org, user, service, cancellationToken);

    private static async Task<IResult> DecideAsync(
        string id,
        bool approve,
        IOrgContextAccessor org,
        ClaimsPrincipal user,
        MembershipService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        await service.DecideJoinRequestAsync(org.OrgMember!, id, approve, UserId(user), cancellationToken);
        return ApiEnvelope.Created(null);
    }

    private static string UserId(ClaimsPrincipal user) => user.FindFirstValue(ClaimTypes.NameIdentifier)!;

    private static void Validate(IReadOnlyList<string> errors)
    {
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }
    }
}
