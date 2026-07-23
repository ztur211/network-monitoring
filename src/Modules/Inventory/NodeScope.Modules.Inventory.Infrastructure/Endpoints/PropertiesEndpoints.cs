using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NodeScope.Modules.Inventory.Application.Properties;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Inventory.Infrastructure.Endpoints;

/// <summary><c>/api/v1/properties</c> (Node's <c>properties.controller.ts</c>).</summary>
internal static class PropertiesEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/properties").RequireOrgMember();

        group.MapGet("", ListAsync);
        group.MapGet("/{id}", GetAsync);
        group.MapPost("", CreateAsync);
        group.MapPatch("/{id}", UpdateAsync);
        group.MapDelete("/{id}", DeleteAsync);
    }

    private static async Task<IResult> ListAsync(
        IOrgContextAccessor org,
        PropertiesService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.ListAsync(org.OrgMember!, cancellationToken));

    private static async Task<IResult> GetAsync(
        string id,
        IOrgContextAccessor org,
        PropertiesService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        return ApiEnvelope.Ok(await service.GetAsync(org.OrgMember!, id, cancellationToken));
    }

    private static async Task<IResult> CreateAsync(
        CreatePropertyRequest body,
        IOrgContextAccessor org,
        PropertiesService service,
        CancellationToken cancellationToken)
    {
        var errors = body.Validate();
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }

        return ApiEnvelope.Created(await service.CreateAsync(org.OrgMember!, body, cancellationToken));
    }

    private static async Task<IResult> UpdateAsync(
        string id,
        ChangesetRequest body,
        IOrgContextAccessor org,
        PropertiesService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        var errors = body.Validate(PropertyFields.MaxChanges);
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }

        return ApiEnvelope.Ok(await service.UpdateAsync(org.OrgMember!, id, body, cancellationToken));
    }

    private static async Task<IResult> DeleteAsync(
        string id,
        IOrgContextAccessor org,
        PropertiesService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        await service.DeleteAsync(org.OrgMember!, id, cancellationToken);
        return ApiEnvelope.Ok(null);
    }
}
