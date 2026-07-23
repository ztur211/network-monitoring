using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NodeScope.Modules.Inventory.Application.Networks;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Inventory.Infrastructure.Endpoints;

/// <summary><c>/api/v1/networks</c> (Node's <c>networks.controller.ts</c>).</summary>
internal static class NetworksEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/networks").RequireOrgMember();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id}", GetAsync);
        group.MapPatch("/{id}", UpdateAsync);
        group.MapPost("/{id}/set-home-ip", SetHomeIpAsync);
        group.MapDelete("/{id}", DeleteAsync);
    }

    private static async Task<IResult> ListAsync(
        IOrgContextAccessor org,
        NetworksService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.ListAsync(org.OrgMember!, cancellationToken));

    private static async Task<IResult> CreateAsync(
        CreateNetworkRequest body,
        IOrgContextAccessor org,
        ClaimsPrincipal user,
        NetworksService service,
        CancellationToken cancellationToken)
    {
        var errors = body.Validate();
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }

        var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
        return ApiEnvelope.Created(await service.CreateAsync(org.OrgMember!, userId, body, cancellationToken));
    }

    private static async Task<IResult> GetAsync(
        string id,
        IOrgContextAccessor org,
        NetworksService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        return ApiEnvelope.Ok(await service.GetAsync(org.OrgMember!, id, cancellationToken));
    }

    private static async Task<IResult> UpdateAsync(
        string id,
        ChangesetRequest body,
        IOrgContextAccessor org,
        NetworksService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        var errors = body.Validate(NetworkFields.MaxChanges);
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }

        return ApiEnvelope.Ok(await service.UpdateAsync(org.OrgMember!, id, body, cancellationToken));
    }

    private static async Task<IResult> SetHomeIpAsync(
        string id,
        HttpContext httpContext,
        IOrgContextAccessor org,
        NetworksService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        var ip = httpContext.Connection.RemoteIpAddress?.ToString() ?? "0.0.0.0";
        return ApiEnvelope.Ok(await service.SetHomeIpAsync(org.OrgMember!, id, ip, cancellationToken));
    }

    private static async Task<IResult> DeleteAsync(
        string id,
        IOrgContextAccessor org,
        NetworksService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        await service.DeleteAsync(org.OrgMember!, id, cancellationToken);
        return ApiEnvelope.Ok(null);
    }
}
