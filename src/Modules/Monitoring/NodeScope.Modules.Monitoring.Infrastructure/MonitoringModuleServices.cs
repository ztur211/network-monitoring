using System.Globalization;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NodeScope.Modules.Monitoring.Application.Agents;
using NodeScope.Modules.Monitoring.Application.Ingest;
using NodeScope.Modules.Monitoring.Application.Prober;
using NodeScope.Modules.Monitoring.Application.Reads;
using NodeScope.Modules.Monitoring.Application.Snmp;
using NodeScope.Modules.Monitoring.Domain;
using NodeScope.Modules.Monitoring.Infrastructure.Endpoints;
using NodeScope.Modules.Monitoring.Infrastructure.Persistence;
using NodeScope.Platform;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Crypto;
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
                    .MapEnum<DeviceStatusState>("DeviceStatusState", nameTranslator: ConstantCaseEnumNameTranslator.Instance)
                    .MapEnum<SnmpVersion>("SnmpVersion", nameTranslator: ConstantCaseEnumNameTranslator.Instance)
                    .MapEnum<SnmpSecurityLevel>("SnmpSecurityLevel", nameTranslator: ConstantCaseEnumNameTranslator.Instance)
                    .MapEnum<SnmpAuthProtocol>("SnmpAuthProtocol", nameTranslator: ConstantCaseEnumNameTranslator.Instance)
                    .MapEnum<SnmpPrivProtocol>("SnmpPrivProtocol", nameTranslator: ConstantCaseEnumNameTranslator.Instance)));

        services.AddScoped<IAgentRepository, AgentRepository>();
        services.AddScoped<AgentTokenService>();
        services.AddScoped<AgentsService>();

        services.AddScoped<IMonitoringRepository, MonitoringRepository>();
        services.AddScoped<IIngestTokenRepository, IngestTokenRepository>();
        services.AddScoped<IngestTokenService>();
        services.AddScoped<IngestService>();
        services.AddScoped<MonitoringReadService>();
        services.AddScoped<IAssistantTelemetryContextProvider, AssistantTelemetryContextProvider>();
        services.AddHostedService<MonitoringCaggInitializer>();

        // The embedded prober (registered always, no-op unless MONITORING_PROBER_ENABLED=true).
        services.AddSingleton(ProberOptions.FromEnvironment(key => configuration[key]));
        services.AddHostedService<Prober.EmbeddedProber>();

        // Fails at boot when SECRET_ENCRYPTION_KEY is missing/short, matching the Node
        // CryptoModule (the SNMP surface cannot run without it).
        services.AddSingleton<ISecretCipher>(
            _ => SecretCipher.FromBase64Key(configuration["SECRET_ENCRYPTION_KEY"]));
        services.AddScoped<ISnmpRepository, SnmpRepository>();
        services.AddScoped<SnmpService>();

        return services;
    }

    public static IEndpointRouteBuilder MapMonitoringEndpoints(this IEndpointRouteBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        AgentsEndpoints.Map(app);
        AgentIngestEndpoints.Map(app);
        IngestEndpoints.Map(app);
        MonitoringReadEndpoints.Map(app);
        SnmpEndpoints.Map(app);
        return app;
    }
}
