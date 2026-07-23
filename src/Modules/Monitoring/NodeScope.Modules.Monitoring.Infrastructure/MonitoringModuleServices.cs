using System.Globalization;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NodeScope.Modules.Monitoring.Application.Agents;
using NodeScope.Modules.Monitoring.Application.Ingest;
using NodeScope.Modules.Monitoring.Domain;
using NodeScope.Modules.Monitoring.Infrastructure.Endpoints;
using NodeScope.Modules.Monitoring.Infrastructure.Persistence;
using NodeScope.Platform;
using NodeScope.Platform.Data;

namespace NodeScope.Modules.Monitoring.Infrastructure;

/// <summary>The Monitoring module's registration + endpoint-mapping pair (Decision 6).</summary>
public static class MonitoringModuleServices
{
    public static IServiceCollection AddMonitoringModule(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services.AddSingleton(new IngestThresholds(
            int.TryParse(configuration["MONITORING_DOWN_THRESHOLD"], out var down)
                ? down
                : IngestThresholds.Default.DownThreshold,
            double.TryParse(
                configuration["MONITORING_WARN_LATENCY_MS"],
                NumberStyles.Float,
                CultureInfo.InvariantCulture,
                out var warn)
                ? warn
                : IngestThresholds.Default.WarnLatencyMs));

        services.AddMemoryCache();
        services.AddDbContext<MonitoringDbContext>((provider, options) =>
            options.UseNpgsql(
                provider.GetRequiredService<DatabaseConnectionString>().Value,
                npgsql => npgsql
                    .MapEnum<AgentStatus>("AgentStatus", nameTranslator: ConstantCaseEnumNameTranslator.Instance)
                    .MapEnum<DeviceStatusState>("DeviceStatusState", nameTranslator: ConstantCaseEnumNameTranslator.Instance)));

        services.AddScoped<IAgentRepository, AgentRepository>();
        services.AddScoped<AgentTokenService>();
        services.AddScoped<AgentsService>();

        services.AddScoped<IMonitoringRepository, MonitoringRepository>();
        services.AddScoped<IIngestTokenRepository, IngestTokenRepository>();
        services.AddScoped<IngestTokenService>();
        services.AddScoped<IngestService>();

        return services;
    }

    public static IEndpointRouteBuilder MapMonitoringEndpoints(this IEndpointRouteBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        AgentsEndpoints.Map(app);
        AgentIngestEndpoints.Map(app);
        IngestEndpoints.Map(app);
        return app;
    }
}
