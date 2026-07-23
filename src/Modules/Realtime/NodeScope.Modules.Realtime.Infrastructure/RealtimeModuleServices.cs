using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Realtime.Infrastructure;

/// <summary>The Realtime module's registration + endpoint-mapping pair (Decision 6).</summary>
public static class RealtimeModuleServices
{
    /// <summary>Where the hub is served. The socket.io path stays free for the Node target during the transition.</summary>
    public const string HubPath = "/hubs/v1";

    public static IServiceCollection AddRealtimeModule(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddSignalR();
        services.AddSingleton<ConnectionRegistry>();
        services.AddSingleton<IConnectionRegistry>(provider => provider.GetRequiredService<ConnectionRegistry>());

        // Registered after the platform's no-op, so this wins: the last registration of a
        // service is the one resolved.
        services.AddSingleton<IRealtimeService, SignalRRealtimeService>();

        return services;
    }

    public static IEndpointRouteBuilder MapRealtimeEndpoints(this IEndpointRouteBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        app.MapHub<NodeScopeHub>(HubPath);
        return app;
    }
}
