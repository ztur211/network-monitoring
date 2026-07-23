using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NodeScope.Modules.Inventory.Application.Map;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Inventory.Infrastructure.Endpoints;

/// <summary><c>/api/v1/map</c> (Node's <c>map.controller.ts</c>) - the viewport reads.</summary>
internal static class MapEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/map").RequireOrgMember();

        group.MapGet("/devices", DevicesAsync);
        group.MapGet("/fiber-runs", FiberRunsAsync);
        group.MapGet("/circuits", CircuitsAsync);
    }

    private static async Task<IResult> DevicesAsync(
        string? bbox,
        int? floor,
        IOrgContextAccessor org,
        MapService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.DevicesAsync(org.OrgMember!, bbox, floor, cancellationToken));

    private static async Task<IResult> FiberRunsAsync(
        string? bbox,
        IOrgContextAccessor org,
        MapService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.FiberRunsAsync(org.OrgMember!, bbox, cancellationToken));

    private static async Task<IResult> CircuitsAsync(
        string? bbox,
        IOrgContextAccessor org,
        MapService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.CircuitsAsync(org.OrgMember!, bbox, cancellationToken));
}
