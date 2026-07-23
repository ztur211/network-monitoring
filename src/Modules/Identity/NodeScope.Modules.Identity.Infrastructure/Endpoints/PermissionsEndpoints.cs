using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NodeScope.Modules.Identity.Application.Permissions;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Identity.Infrastructure.Endpoints;

/// <summary>
/// The permission graph's HTTP surface (Node's <c>permissions</c>, <c>teams</c>, and
/// <c>member-assignments</c> controllers). No role attributes: the service enforces the
/// delegation rules itself, because they depend on the target as much as on the actor.
/// </summary>
internal static class PermissionsEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/access/me", AccessSummaryAsync).RequireOrgMember();

        var teams = app.MapGroup("/api/v1/teams").RequireOrgMember();
        teams.MapGet("", ListTeamsAsync);
        teams.MapPost("", CreateTeamAsync);
        teams.MapPatch("/{id}", RenameTeamAsync);
        teams.MapDelete("/{id}", DeleteTeamAsync);
        teams.MapPost("/{id}/members", AddTeamMemberAsync);
        teams.MapDelete("/{id}/members/{memberId}", RemoveTeamMemberAsync);
        teams.MapPost("/{id}/properties", AssignSiteAsync);
        teams.MapDelete("/{id}/properties/{propertyId}", UnassignSiteAsync);

        var members = app.MapGroup("/api/v1/members/{memberId}").RequireOrgMember();
        members.MapGet("/access", MemberAccessAsync);
        members.MapPost("/properties", GrantSiteAsync);
        members.MapDelete("/properties/{propertyId}", RevokeSiteAsync);
    }

    private static async Task<IResult> AccessSummaryAsync(
        IOrgContextAccessor org,
        PermissionsService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.AccessSummaryAsync(org.OrgMember!, cancellationToken));

    private static async Task<IResult> MemberAccessAsync(
        string memberId,
        IOrgContextAccessor org,
        PermissionsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(memberId);
        return ApiEnvelope.Ok(await service.MemberAccessAsync(org.OrgMember!, memberId, cancellationToken));
    }

    private static async Task<IResult> ListTeamsAsync(
        IOrgContextAccessor org,
        PermissionsService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.ListTeamsAsync(org.OrgMember!, cancellationToken));

    private static async Task<IResult> CreateTeamAsync(
        CreateTeamRequest body,
        IOrgContextAccessor org,
        PermissionsService service,
        CancellationToken cancellationToken)
    {
        Validate(body.Validate());
        return ApiEnvelope.Created(await service.CreateTeamAsync(org.OrgMember!, body, cancellationToken));
    }

    private static async Task<IResult> RenameTeamAsync(
        string id,
        UpdateTeamRequest body,
        IOrgContextAccessor org,
        PermissionsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        Validate(body.Validate());
        return ApiEnvelope.Ok(await service.RenameTeamAsync(org.OrgMember!, id, body, cancellationToken));
    }

    private static async Task<IResult> DeleteTeamAsync(
        string id,
        IOrgContextAccessor org,
        PermissionsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        await service.DeleteTeamAsync(org.OrgMember!, id, cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> AddTeamMemberAsync(
        string id,
        AddTeamMemberRequest body,
        IOrgContextAccessor org,
        PermissionsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        Validate(body.Validate());
        return ApiEnvelope.Created(
            await service.AddTeamMemberAsync(org.OrgMember!, id, body.MemberId!, cancellationToken));
    }

    private static async Task<IResult> RemoveTeamMemberAsync(
        string id,
        string memberId,
        IOrgContextAccessor org,
        PermissionsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        RouteParams.RequireUuid(memberId);
        await service.RemoveTeamMemberAsync(org.OrgMember!, id, memberId, cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> AssignSiteAsync(
        string id,
        AddPropertyRequest body,
        IOrgContextAccessor org,
        PermissionsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        Validate(body.Validate());
        return ApiEnvelope.Created(
            await service.AssignSiteToTeamAsync(org.OrgMember!, id, body.PropertyId!, cancellationToken));
    }

    private static async Task<IResult> UnassignSiteAsync(
        string id,
        string propertyId,
        IOrgContextAccessor org,
        PermissionsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        RouteParams.RequireUuid(propertyId);
        await service.UnassignSiteFromTeamAsync(org.OrgMember!, id, propertyId, cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> GrantSiteAsync(
        string memberId,
        AddPropertyRequest body,
        IOrgContextAccessor org,
        PermissionsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(memberId);
        Validate(body.Validate());
        return ApiEnvelope.Created(
            await service.GrantSiteAsync(org.OrgMember!, memberId, body.PropertyId!, cancellationToken));
    }

    private static async Task<IResult> RevokeSiteAsync(
        string memberId,
        string propertyId,
        IOrgContextAccessor org,
        PermissionsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(memberId);
        RouteParams.RequireUuid(propertyId);
        await service.RevokeSiteAsync(org.OrgMember!, memberId, propertyId, cancellationToken);
        return Results.NoContent();
    }

    private static void Validate(IReadOnlyList<string> errors)
    {
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }
    }
}
