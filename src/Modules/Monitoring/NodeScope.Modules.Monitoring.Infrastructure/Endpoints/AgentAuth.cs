using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using NodeScope.Modules.Monitoring.Application.Agents;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Monitoring.Infrastructure.Endpoints;

/// <summary>
/// The <c>x-agent-token</c> credential check, ported from the Node <c>AgentTokenGuard</c>:
/// verify the token (revoked = unknown), attach the resolved identity to the request, and
/// bump the agent's <c>lastSeenAt</c> - throttled to one Postgres write per agent per
/// 60-second window. The Node side used a Redis NX/EX gate for the throttle; this is a
/// single-node in-process gate (recorded in the decision log), with the same fail-open rule:
/// when the gate itself fails, write rather than silently lose last-seen.
/// </summary>
internal static class AgentAuth
{
    private const string ItemKey = "nodescope.agent";
    private static readonly TimeSpan LastSeenThrottle = TimeSpan.FromSeconds(60);

    /// <summary>The verified agent identity attached by <see cref="RequireAgentTokenAsync"/>.</summary>
    public static AgentIdentity CurrentAgent(HttpContext context) =>
        context.Items[ItemKey] as AgentIdentity
        ?? throw new InvalidOperationException("Endpoint reached without the agent-token filter");

    /// <summary>Endpoint filter enforcing the header; rejections surface as 401 <c>AUTH_002</c>.</summary>
    public static async ValueTask<object?> RequireAgentTokenAsync(
        EndpointFilterInvocationContext context,
        EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        var tokens = http.RequestServices.GetRequiredService<AgentTokenService>();
        var identity = await tokens.VerifyTokenAsync(
            http.Request.Headers["x-agent-token"].ToString(),
            http.RequestAborted);
        if (identity is null)
        {
            throw ApiErrors.SessionInvalid();
        }

        http.Items[ItemKey] = identity;
        await TouchLastSeenThrottledAsync(http, identity.AgentId);
        return await next(context);
    }

    private static async Task TouchLastSeenThrottledAsync(HttpContext http, string agentId)
    {
        var cache = http.RequestServices.GetRequiredService<IMemoryCache>();
        var key = $"agent:lastseen:{agentId}";
        if (cache.TryGetValue(key, out _))
        {
            return;
        }

        cache.Set(key, true, LastSeenThrottle);
        var repo = http.RequestServices.GetRequiredService<IAgentRepository>();
        await repo.TouchLastSeenAsync(agentId, http.RequestAborted);
    }
}
