using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NodeScope.Modules.Inventory.Application.Devices;
using NodeScope.Modules.Inventory.Domain;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Inventory.Infrastructure.Endpoints;

/// <summary><c>/api/v1/devices</c> (Node's <c>devices.controller.ts</c>).</summary>
internal static class DevicesEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/devices").RequireOrgMember();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        // Mapped before "/{id}" so the literal segment is not swallowed by the id route.
        group.MapGet("/name-suggestion", NameSuggestionAsync);
        group.MapGet("/{id}", GetAsync);
        group.MapPatch("/{id}", UpdateAsync);
        group.MapDelete("/{id}", DeleteAsync);
    }

    private static async Task<IResult> ListAsync(
        string? buildingPropertyId,
        IOrgContextAccessor org,
        DevicesService service,
        CancellationToken cancellationToken)
    {
        // ?buildingPropertyId scopes to a building subtree and answers a BARE array;
        // the unfiltered list is the { items, total } envelope.
        if (string.IsNullOrEmpty(buildingPropertyId))
        {
            return ApiEnvelope.Ok(await service.ListAsync(org.OrgMember!, cancellationToken));
        }

        return ApiEnvelope.Ok(
            await service.ListForBuildingAsync(org.OrgMember!, buildingPropertyId, cancellationToken));
    }

    private static async Task<IResult> CreateAsync(
        CreateDeviceRequest body,
        IOrgContextAccessor org,
        ClaimsPrincipal user,
        DevicesService service,
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

    private static async Task<IResult> NameSuggestionAsync(
        string? propertyId,
        string? category,
        string? roleCode,
        IOrgContextAccessor org,
        NameSuggestionService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(propertyId ?? "");
        var parsedCategory = DeviceCategoryLabels.TryParse(category)
            ?? throw ApiErrors.Validation(["Validation failed (enum string is expected)"]);
        var suggestedName = await service.SuggestAsync(
            org.OrgMember!.OrganizationId, propertyId!, parsedCategory, roleCode, cancellationToken);
        return ApiEnvelope.Ok(new { suggestedName });
    }

    private static async Task<IResult> GetAsync(
        string id,
        IOrgContextAccessor org,
        DevicesService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        return ApiEnvelope.Ok(await service.GetAsync(org.OrgMember!, id, cancellationToken));
    }

    private static async Task<IResult> UpdateAsync(
        string id,
        ChangesetRequest body,
        IOrgContextAccessor org,
        DevicesService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        var errors = body.Validate(DeviceFields.MaxChanges);
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }

        return ApiEnvelope.Ok(await service.UpdateAsync(org.OrgMember!, id, body, cancellationToken));
    }

    private static async Task<IResult> DeleteAsync(
        string id,
        IOrgContextAccessor org,
        DevicesService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        await service.DeleteAsync(org.OrgMember!, id, cancellationToken);
        return ApiEnvelope.Ok(null);
    }
}
