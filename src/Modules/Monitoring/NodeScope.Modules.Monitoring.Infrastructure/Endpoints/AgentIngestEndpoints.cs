using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NodeScope.Modules.Monitoring.Application.Agents;
using NodeScope.Modules.Monitoring.Application.Snmp;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Monitoring.Infrastructure.Endpoints;

/// <summary>
/// <c>/api/v1/monitoring/agent</c> - the collector-facing surface (Node's
/// <c>agent-ingest.controller.ts</c>): code-authenticated enroll, and token-authenticated
/// devices/heartbeat.
/// </summary>
internal static class AgentIngestEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/monitoring/agent");

        group.MapPost("/enroll", EnrollAsync);
        group.MapGet("/devices", DevicesAsync).AddEndpointFilter(AgentAuth.RequireAgentTokenAsync);
        group.MapPost("/heartbeat", HeartbeatAsync).AddEndpointFilter(AgentAuth.RequireAgentTokenAsync);
    }

    private static async Task<IResult> EnrollAsync(
        EnrollRequest body,
        AgentTokenService tokens,
        CancellationToken cancellationToken)
    {
        var errors = body.Validate();
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }

        var result = await tokens.EnrollAsync(body.Code!, body.Name!, body.Platform!, body.Version!, cancellationToken);
        return ApiEnvelope.Created(new { agentId = result.AgentId, token = result.Token });
    }

    private static async Task<IResult> DevicesAsync(
        HttpContext http,
        IAgentRepository repo,
        SnmpService snmp,
        CancellationToken cancellationToken)
    {
        var agent = AgentAuth.CurrentAgent(http);
        var devices = await repo.ListOrgDevicesWithIpAsync(agent.OrganizationId, cancellationToken);
        return ApiEnvelope.Ok(await snmp.AttachTargetsAsync(agent.OrganizationId, devices, cancellationToken));
    }

    /// <summary>
    /// 204 with no response body. The token filter already bumped <c>lastSeenAt</c>. The
    /// body's optional <c>{"version"}</c> is persisted here - Decision 13's step-4
    /// obligation: the Node API binds no body on this route (so the field is contract-safe),
    /// but ignoring it would leave <c>Agent.version</c> stale after self-updates. Parsing is
    /// deliberately lenient: a heartbeat must never fail over its optional payload.
    /// </summary>
    private static async Task<IResult> HeartbeatAsync(
        HttpContext http,
        IAgentRepository repo,
        CancellationToken cancellationToken)
    {
        var agent = AgentAuth.CurrentAgent(http);
        var version = await TryReadVersionAsync(http.Request, cancellationToken);
        if (version is not null)
        {
            await repo.SetVersionIfChangedAsync(agent.AgentId, version, cancellationToken);
        }

        return Results.NoContent();
    }

    private static async Task<string?> TryReadVersionAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        if (request.ContentLength is null or 0)
        {
            return null;
        }

        try
        {
            using var document = await JsonDocument.ParseAsync(request.Body, cancellationToken: cancellationToken);
            return document.RootElement.ValueKind == JsonValueKind.Object
                && document.RootElement.TryGetProperty("version", out var version)
                && version.ValueKind == JsonValueKind.String
                ? version.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
