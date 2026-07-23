using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using NodeScope.Modules.Monitoring.Application.Agents;
using NodeScope.Modules.Monitoring.Domain;
using NodeScope.Modules.Monitoring.Infrastructure.Endpoints;
using NodeScope.Modules.Monitoring.Infrastructure.Persistence;
using NodeScope.Platform;
using NodeScope.Platform.Data;

namespace NodeScope.Modules.Monitoring.Infrastructure;

/// <summary>The Monitoring module's registration + endpoint-mapping pair (Decision 6).</summary>
public static class MonitoringModuleServices
{
    public static IServiceCollection AddMonitoringModule(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddMemoryCache();
        services.AddDbContext<MonitoringDbContext>((provider, options) =>
            options.UseNpgsql(
                provider.GetRequiredService<DatabaseConnectionString>().Value,
                npgsql => npgsql.MapEnum<AgentStatus>(
                    "AgentStatus",
                    nameTranslator: ConstantCaseEnumNameTranslator.Instance)));

        services.AddScoped<IAgentRepository, AgentRepository>();
        services.AddScoped<AgentTokenService>();
        services.AddScoped<AgentsService>();

        return services;
    }

    public static IEndpointRouteBuilder MapMonitoringEndpoints(this IEndpointRouteBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        AgentsEndpoints.Map(app);
        AgentIngestEndpoints.Map(app);
        return app;
    }
}
