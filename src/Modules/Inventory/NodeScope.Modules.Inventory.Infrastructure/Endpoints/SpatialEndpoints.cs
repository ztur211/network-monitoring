using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NodeScope.Modules.Inventory.Application.Devices;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Inventory.Infrastructure.Endpoints;

/// <summary>
/// Device 3D placement under <c>/api/v1/devices</c> (Node's <c>spatial.controller.ts</c>).
/// A separate group from <see cref="DevicesEndpoints"/> because these two routes are
/// OWNER/ADMIN-gated while the rest of the device surface is not.
/// </summary>
internal static class SpatialEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/devices")
            .RequireOrgRoles(OrgRoleNames.Owner, OrgRoleNames.Admin);

        group.MapPatch("/{id}/position", SetPositionAsync);
        group.MapPatch("/{id}/ifc-link", SetIfcLinkAsync);
    }

    private static async Task<IResult> SetPositionAsync(
        string id,
        DevicePositionRequest body,
        IOrgContextAccessor org,
        SpatialService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        return ApiEnvelope.Ok(await service.SetPositionAsync(org.OrgMember!, id, body, cancellationToken));
    }

    private static async Task<IResult> SetIfcLinkAsync(
        string id,
        DeviceIfcLinkRequest body,
        IOrgContextAccessor org,
        SpatialService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        var errors = body.Validate();
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }

        return ApiEnvelope.Ok(await service.SetIfcLinkAsync(org.OrgMember!, id, body, cancellationToken));
    }
}
