using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NodeScope.Modules.Inventory.Application.Links;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Inventory.Infrastructure.Endpoints;

/// <summary><c>/api/v1/circuits</c> (Node's <c>circuits.controller.ts</c>) - the one cursor-paginated list.</summary>
internal static class CircuitsEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/circuits").RequireOrgMember();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id}", GetAsync);
        group.MapPatch("/{id}", UpdateAsync);
        group.MapDelete("/{id}", DeleteAsync);
    }

    private static async Task<IResult> ListAsync(
        int? limit,
        string? cursor,
        IOrgContextAccessor org,
        CircuitsService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.ListAsync(org.OrgMember!, limit, cursor, cancellationToken));

    private static async Task<IResult> CreateAsync(
        CreateCircuitRequest body,
        IOrgContextAccessor org,
        ClaimsPrincipal user,
        CircuitsService service,
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
        CircuitsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        return ApiEnvelope.Ok(await service.GetAsync(org.OrgMember!, id, cancellationToken));
    }

    private static async Task<IResult> UpdateAsync(
        string id,
        ChangesetRequest body,
        IOrgContextAccessor org,
        CircuitsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        var errors = body.Validate(CircuitFields.MaxChanges);
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }

        return ApiEnvelope.Ok(await service.UpdateAsync(org.OrgMember!, id, body, cancellationToken));
    }

    private static async Task<IResult> DeleteAsync(
        string id,
        IOrgContextAccessor org,
        CircuitsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        await service.DeleteAsync(org.OrgMember!, id, cancellationToken);
        return ApiEnvelope.Ok(null);
    }
}

/// <summary><c>/api/v1/fiber-runs</c> (Node's <c>fiber-runs.controller.ts</c>).</summary>
internal static class FiberRunsEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/fiber-runs").RequireOrgMember();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id}", GetAsync);
        group.MapPatch("/{id}", UpdateAsync);
        group.MapDelete("/{id}", DeleteAsync);
    }

    private static async Task<IResult> ListAsync(
        string? deviceId,
        IOrgContextAccessor org,
        FiberRunsService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.ListAsync(org.OrgMember!, deviceId, cancellationToken));

    private static async Task<IResult> CreateAsync(
        CreateFiberRunRequest body,
        IOrgContextAccessor org,
        ClaimsPrincipal user,
        FiberRunsService service,
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
        FiberRunsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        return ApiEnvelope.Ok(await service.GetAsync(org.OrgMember!, id, cancellationToken));
    }

    private static async Task<IResult> UpdateAsync(
        string id,
        ChangesetRequest body,
        IOrgContextAccessor org,
        FiberRunsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        var errors = body.Validate(FiberRunFields.MaxChanges);
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }

        return ApiEnvelope.Ok(await service.UpdateAsync(org.OrgMember!, id, body, cancellationToken));
    }

    private static async Task<IResult> DeleteAsync(
        string id,
        IOrgContextAccessor org,
        FiberRunsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        await service.DeleteAsync(org.OrgMember!, id, cancellationToken);
        return ApiEnvelope.Ok(null);
    }
}

/// <summary><c>/api/v1/device-connections</c> (Node's <c>connections.controller.ts</c>).</summary>
internal static class ConnectionsEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/device-connections").RequireOrgMember();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id}", GetAsync);
        group.MapPatch("/{id}", UpdateAsync);
        group.MapDelete("/{id}", DeleteAsync);
    }

    private static async Task<IResult> ListAsync(
        string? deviceId,
        IOrgContextAccessor org,
        ConnectionsService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.ListAsync(org.OrgMember!, deviceId, cancellationToken));

    private static async Task<IResult> CreateAsync(
        CreateConnectionRequest body,
        IOrgContextAccessor org,
        ClaimsPrincipal user,
        ConnectionsService service,
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
        ConnectionsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        return ApiEnvelope.Ok(await service.GetAsync(org.OrgMember!, id, cancellationToken));
    }

    private static async Task<IResult> UpdateAsync(
        string id,
        ChangesetRequest body,
        IOrgContextAccessor org,
        ConnectionsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        var errors = body.Validate(ConnectionFields.MaxChanges);
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }

        return ApiEnvelope.Ok(await service.UpdateAsync(org.OrgMember!, id, body, cancellationToken));
    }

    private static async Task<IResult> DeleteAsync(
        string id,
        IOrgContextAccessor org,
        ConnectionsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        await service.DeleteAsync(org.OrgMember!, id, cancellationToken);
        return ApiEnvelope.Ok(null);
    }
}
