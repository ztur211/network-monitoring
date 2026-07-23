using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using NodeScope.Modules.Monitoring.Application.Agents;
using NodeScope.Modules.Monitoring.Application.Ingest;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Monitoring.Infrastructure.Endpoints;

/// <summary>
/// <c>/api/v1/monitoring/ingest</c> + <c>/ingest-token</c> (Node's
/// <c>ingest.controller.ts</c>). Ingest is machine-authenticated by either token family;
/// the item-cap check maps to the retryable 413 <c>GEN_005</c> BEFORE field validation's
/// 400 - the split-vs-drop control signal the agent depends on.
/// </summary>
internal static class IngestEndpoints
{
    private const string OrgItemKey = "nodescope.ingestOrg";
    private const string SourceItemKey = "nodescope.ingestSource";

    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/monitoring");
        group.MapPost("/ingest", IngestAsync).AddEndpointFilter(RequireIngestTokenAsync);
        group.MapPost("/ingest-token", RotateTokenAsync).RequireOrgRoles(OrgRoleNames.Owner);
    }

    /// <summary>
    /// Agent token first (sets the per-agent source and bumps <c>lastSeenAt</c>, unthrottled
    /// on this path, exactly like the Node guard), then the org token from
    /// <c>x-ingest-token</c> or <c>Authorization: Bearer</c>.
    /// </summary>
    private static async ValueTask<object?> RequireIngestTokenAsync(
        EndpointFilterInvocationContext context,
        EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        var agentToken = http.Request.Headers["x-agent-token"].ToString();
        if (agentToken.Length > 0)
        {
            var tokens = http.RequestServices.GetRequiredService<AgentTokenService>();
            var agent = await tokens.VerifyTokenAsync(agentToken, http.RequestAborted);
            if (agent is not null)
            {
                http.Items[OrgItemKey] = agent.OrganizationId;
                http.Items[SourceItemKey] = $"agent:{agent.AgentId}";
                var agents = http.RequestServices.GetRequiredService<IAgentRepository>();
                await agents.TouchLastSeenAsync(agent.AgentId, http.RequestAborted);
                return await next(context);
            }
        }

        var header = http.Request.Headers["x-ingest-token"].ToString();
        var authorization = http.Request.Headers.Authorization.ToString();
        var token = header.Length > 0
            ? header
            : authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
                ? authorization["Bearer ".Length..].Trim()
                : string.Empty;
        var ingestTokens = http.RequestServices.GetRequiredService<IngestTokenService>();
        var organizationId = await ingestTokens.VerifyAsync(token, http.RequestAborted);
        if (organizationId is null)
        {
            throw ApiErrors.SessionInvalid();
        }

        http.Items[OrgItemKey] = organizationId;
        return await next(context);
    }

    private static async Task<IResult> IngestAsync(
        IngestBatchRequest? body,
        HttpContext http,
        IngestService ingest,
        CancellationToken cancellationToken)
    {
        body ??= new IngestBatchRequest();
        if (body.ExceedsCaps())
        {
            throw new ApiException(
                "GEN_005",
                $"INGEST_BATCH_TOO_LARGE: max {IngestBatchRequest.MaxChecksPerBatch} checks and "
                    + $"{IngestBatchRequest.MaxMetricsPerBatch} metrics per batch "
                    + $"(got {body.Checks?.Count ?? 0} / {body.Metrics?.Count ?? 0}); split and retry",
                StatusCodes.Status413PayloadTooLarge);
        }

        var errors = body.Validate();
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }

        var organizationId = (string)http.Items[OrgItemKey]!;
        var sourceOverride = http.Items.TryGetValue(SourceItemKey, out var source) ? source as string : null;
        await ingest.IngestBatchAsync(organizationId, body.Checks ?? [], body.Metrics ?? [], sourceOverride, cancellationToken);

        var accepted = (body.Checks?.Count ?? 0) + (body.Metrics?.Count ?? 0);
        return ApiEnvelope.Ok(new { accepted }, StatusCodes.Status202Accepted);
    }

    private static async Task<IResult> RotateTokenAsync(
        IOrgContextAccessor org,
        IngestTokenService tokens,
        CancellationToken cancellationToken)
    {
        var token = await tokens.CreateOrRotateAsync(org.OrgMember!.OrganizationId, cancellationToken);
        return ApiEnvelope.Created(new { token });
    }
}
