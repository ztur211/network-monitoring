using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Realtime.Infrastructure;

/// <summary>The Realtime module's registration + endpoint-mapping pair (Decision 6).</summary>
public static class RealtimeModuleServices
{
    /// <summary>Where the hub is served. The socket.io path stays free for the Node target during the transition.</summary>
    public const string HubPath = "/hubs/v1";

    public static IServiceCollection AddRealtimeModule(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services.AddSignalR();
        services.AddSingleton<ConnectionRegistry>();
        services.AddSingleton<IConnectionRegistry>(provider => provider.GetRequiredService<ConnectionRegistry>());
        services.AddSingleton(MetricsSubmitLimiter.FromConfiguration(configuration));

        // Registered after the platform's no-op, so this wins: the last registration of a
        // service is the one resolved.
        services.AddSingleton<IRealtimeService, SignalRRealtimeService>();
        services.AddHostedService<MetricsPushService>();

        return services;
    }

    public static IEndpointRouteBuilder MapRealtimeEndpoints(this IEndpointRouteBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        // Unthrottled: socket.io traffic never passed through Nest's HTTP guards either.
        // The metrics:submit write path has its own per-user limiter inside the hub.
        app.MapHub<NodeScopeHub>(HubPath).SkipThrottle();
        return app;
    }
}
