using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NodeScope.Modules.Inventory.Application.Properties;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Inventory.Infrastructure.Endpoints;

/// <summary><c>/api/v1/networks/:networkId/properties</c> (Node's <c>network-property.controller.ts</c>).</summary>
internal static class NetworkPropertyEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/networks/{networkId}/properties").RequireOrgMember();

        group.MapGet("", ListAsync);
        group.MapPost("", AddAsync);
        group.MapDelete("/{propertyId}", RemoveAsync);
    }

    private static async Task<IResult> ListAsync(
        string networkId,
        IOrgContextAccessor org,
        NetworkPropertyService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(networkId);
        return ApiEnvelope.Ok(await service.ListAsync(org.OrgMember!, networkId, cancellationToken));
    }

    private static async Task<IResult> AddAsync(
        string networkId,
        AddCharterRequest body,
        IOrgContextAccessor org,
        NetworkPropertyService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(networkId);
        var errors = body.Validate();
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }

        // Nest POST default 201, no @HttpCode override in the Node controller.
        return ApiEnvelope.Created(
            await service.AddAsync(org.OrgMember!, networkId, body.PropertyId!, cancellationToken));
    }

    private static async Task<IResult> RemoveAsync(
        string networkId,
        string propertyId,
        IOrgContextAccessor org,
        NetworkPropertyService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(networkId);
        RouteParams.RequireUuid(propertyId);
        await service.RemoveAsync(org.OrgMember!, networkId, propertyId, cancellationToken);
        return ApiEnvelope.Ok(null);
    }
}
