using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NodeScope.Modules.Alerting.Application;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Alerting.Infrastructure.Endpoints;

internal static class AlertEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/alerts")
            .RequireOrgRoles(OrgRoleNames.Owner, OrgRoleNames.Admin);

        group.MapPost("/channels", CreateChannelAsync);
        group.MapGet("/channels", ListChannelsAsync);
        group.MapDelete("/channels/{id}", DeleteChannelAsync);
        group.MapPost("/channels/{id}/test", TestChannelAsync);
        group.MapPost("/rules", CreateRuleAsync);
        group.MapGet("/rules", ListRulesAsync);
        group.MapDelete("/rules/{id}", DeleteRuleAsync);
        group.MapGet("/events", ListEventsAsync);
    }

    private static async Task<IResult> CreateChannelAsync(
        CreateAlertChannelRequest body,
        IOrgContextAccessor org,
        AlertsService service,
        CancellationToken cancellationToken)
    {
        var errors = body.Validate();
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }

        return ApiEnvelope.Created(await service.CreateChannelAsync(
            org.OrgMember!.OrganizationId,
            body,
            cancellationToken));
    }

    private static async Task<IResult> ListChannelsAsync(
        IOrgContextAccessor org,
        AlertsService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.ListChannelsAsync(
            org.OrgMember!.OrganizationId,
            cancellationToken));

    private static async Task<IResult> DeleteChannelAsync(
        string id,
        IOrgContextAccessor org,
        AlertsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        await service.DeleteChannelAsync(org.OrgMember!.OrganizationId, id, cancellationToken);
        return ApiEnvelope.Ok(new { id });
    }

    private static async Task<IResult> TestChannelAsync(
        string id,
        IOrgContextAccessor org,
        AlertsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        await service.TestChannelAsync(org.OrgMember!.OrganizationId, id, cancellationToken);
        return ApiEnvelope.Ok(new { sent = true });
    }

    private static async Task<IResult> CreateRuleAsync(
        CreateAlertRuleRequest body,
        IOrgContextAccessor org,
        AlertsService service,
        CancellationToken cancellationToken)
    {
        var errors = body.Validate();
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }

        return ApiEnvelope.Created(await service.CreateRuleAsync(
            org.OrgMember!.OrganizationId,
            body,
            cancellationToken));
    }

    private static async Task<IResult> ListRulesAsync(
        IOrgContextAccessor org,
        AlertsService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.ListRulesAsync(
            org.OrgMember!.OrganizationId,
            cancellationToken));

    private static async Task<IResult> DeleteRuleAsync(
        string id,
        IOrgContextAccessor org,
        AlertsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(id);
        await service.DeleteRuleAsync(org.OrgMember!.OrganizationId, id, cancellationToken);
        return ApiEnvelope.Ok(new { id });
    }

    private static async Task<IResult> ListEventsAsync(
        int? limit,
        IOrgContextAccessor org,
        AlertsService service,
        CancellationToken cancellationToken)
    {
        var take = Math.Clamp(limit ?? 200, 1, 200);
        return ApiEnvelope.Ok(await service.ListEventsAsync(
            org.OrgMember!.OrganizationId,
            take,
            cancellationToken));
    }
}
