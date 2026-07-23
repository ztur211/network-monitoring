using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NodeScope.Modules.Monitoring.Application.Agents;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Monitoring.Infrastructure.Endpoints;

/// <summary>
/// <c>/api/v1/agents</c> - OWNER/ADMIN session management of the agent registry
/// (Node's <c>agents.controller.ts</c>).
/// </summary>
internal static class AgentsEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/agents")
            .RequireOrgRoles(OrgRoleNames.Owner, OrgRoleNames.Admin);

        group.MapPost("/enrollment-code", GenerateEnrollmentCodeAsync);
        group.MapGet("", ListAsync);
        group.MapPost("/{id}/revoke", RevokeAsync);
        group.MapDelete("/{id}", DeleteAsync);
    }

    private static async Task<IResult> GenerateEnrollmentCodeAsync(
        IOrgContextAccessor org,
        AgentsService service,
        CancellationToken cancellationToken)
    {
        var member = org.OrgMember!;
        var code = await service.GenerateEnrollmentCodeAsync(member.OrganizationId, member.MemberId, cancellationToken);
        return ApiEnvelope.Created(new { code });
    }

    private static async Task<IResult> ListAsync(
        IOrgContextAccessor org,
        AgentsService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.ListAgentsAsync(org.OrgMember!.OrganizationId, cancellationToken));

    private static async Task<IResult> RevokeAsync(
        string id,
        IOrgContextAccessor org,
        AgentsService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.RevokeAgentAsync(org.OrgMember!.OrganizationId, id, cancellationToken));

    private static async Task<IResult> DeleteAsync(
        string id,
        IOrgContextAccessor org,
        AgentsService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.DeleteAgentAsync(org.OrgMember!.OrganizationId, id, cancellationToken));
}
