using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NodeScope.Modules.Identity.Application.Organizations;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Identity.Infrastructure.Endpoints;

/// <summary>
/// <c>/api/v1/organizations/me</c> (Node's <c>organizations.controller.ts</c> and
/// <c>members.controller.ts</c>): the caller's own organization, its roster, and the two
/// membership mutations.
/// </summary>
internal static class OrganizationsEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var reads = app.MapGroup("/api/v1/organizations/me").RequireOrgMember();
        reads.MapGet("", GetMineAsync);
        reads.MapGet("/members", GetMembersAsync);

        var writes = app.MapGroup("/api/v1/organizations/me")
            .RequireOrgRoles(OrgRoleNames.Owner, OrgRoleNames.Admin);
        writes.MapPatch("", UpdateMineAsync);
        writes.MapPatch("/members/{userId}", ChangeMemberRoleAsync);
        writes.MapDelete("/members/{userId}", RemoveMemberAsync);
    }

    private static async Task<IResult> GetMineAsync(
        IOrgContextAccessor org,
        OrganizationsService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.GetMineAsync(org.OrgMember!, cancellationToken));

    private static async Task<IResult> GetMembersAsync(
        IOrgContextAccessor org,
        OrganizationsService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.GetMembersAsync(org.OrgMember!, cancellationToken));

    private static async Task<IResult> UpdateMineAsync(
        ChangesetRequest body,
        IOrgContextAccessor org,
        OrganizationsService service,
        CancellationToken cancellationToken)
    {
        var errors = body.Validate(OrganizationFields.MaxChanges);
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }

        return ApiEnvelope.Ok(await service.UpdateMineAsync(org.OrgMember!, body, cancellationToken));
    }

    private static async Task<IResult> ChangeMemberRoleAsync(
        string userId,
        ChangeMemberRoleRequest body,
        IOrgContextAccessor org,
        OrganizationsService service,
        CancellationToken cancellationToken)
    {
        var errors = body.Validate();
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }

        await service.ChangeMemberRoleAsync(org.OrgMember!, userId, body.Role!, cancellationToken);
        return ApiEnvelope.Ok(null);
    }

    private static async Task<IResult> RemoveMemberAsync(
        string userId,
        IOrgContextAccessor org,
        OrganizationsService service,
        CancellationToken cancellationToken)
    {
        await service.RemoveMemberAsync(org.OrgMember!, userId, cancellationToken);
        return ApiEnvelope.Ok(null);
    }
}
