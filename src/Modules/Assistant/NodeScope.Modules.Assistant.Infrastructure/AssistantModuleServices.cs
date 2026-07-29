using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using NodeScope.Modules.Assistant.Application;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Assistant.Infrastructure;

/// <summary>The Assistant module's registration + endpoint-mapping pair (Decision 6).</summary>
public static class AssistantModuleServices
{
    public static IServiceCollection AddAssistantModule(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services.AddMemoryCache();
        services.AddSingleton(new AiLimits(configuration));
        services.AddSingleton<IAiUsageCounters, MemoryAiUsageCounters>();
        services.AddSingleton<IAiConversationStore, MemoryAiConversationStore>();
        services.TryAddScoped<IAssistantDeviceContextProvider, EmptyDeviceContextProvider>();
        services.TryAddScoped<IAssistantTelemetryContextProvider, EmptyTelemetryContextProvider>();
        services.AddScoped<AiService>();
        services.AddScoped<IAssistantResponder, AssistantResponder>();

        return services;
    }

    public static IEndpointRouteBuilder MapAssistantEndpoints(this IEndpointRouteBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        AiEndpoints.Map(app);
        return app;
    }
}

internal sealed class EmptyDeviceContextProvider : IAssistantDeviceContextProvider
{
    public Task<AssistantDeviceContext?> FindVisibleAsync(
        OrgMemberContext member,
        string deviceId,
        CancellationToken cancellationToken) =>
        Task.FromResult<AssistantDeviceContext?>(null);
}

internal sealed class EmptyTelemetryContextProvider : IAssistantTelemetryContextProvider
{
    public Task<AssistantTelemetryContext> GetAsync(
        string organizationId,
        string deviceId,
        CancellationToken cancellationToken) =>
        Task.FromResult(new AssistantTelemetryContext("UNKNOWN", null, null, [], []));
}

/// <summary>
/// The quota counters, in process. Node keeps them in Redis under hour/day/month keys; on a
/// single-node appliance (Decision 8) the cache holds the same counts with the same expiries.
/// Nothing increments them yet - Decision 9 moved inference to the desktop client, so the
/// server counts only what it is asked to charge, which today is nothing.
/// </summary>
internal sealed class MemoryAiUsageCounters : IAiUsageCounters
{
    private readonly IMemoryCache _cache;

    public MemoryAiUsageCounters(IMemoryCache cache)
    {
        _cache = cache;
    }

    public Task<(int Hourly, int Daily, int MonthlyTokens)> ReadAsync(
        string userId,
        CancellationToken cancellationToken) =>
        Task.FromResult((
            _cache.Get<int>($"ai:rate:hourly:{userId}"),
            _cache.Get<int>($"ai:rate:daily:{userId}"),
            _cache.Get<int>($"ai:tokens:monthly:{userId}")));
}

/// <summary>Conversations, in process, for the same reason as the counters.</summary>
internal sealed class MemoryAiConversationStore : IAiConversationStore
{
    private readonly IMemoryCache _cache;

    public MemoryAiConversationStore(IMemoryCache cache)
    {
        _cache = cache;
    }

    public Task<bool> DeleteAsync(string userId, string conversationId, CancellationToken cancellationToken)
    {
        var key = $"ai:conv:{userId}:{conversationId}";
        if (_cache.TryGetValue(key, out _))
        {
            _cache.Remove(key);
            return Task.FromResult(true);
        }

        return Task.FromResult(false);
    }
}
