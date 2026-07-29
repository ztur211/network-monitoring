using System.Globalization;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NodeScope.Modules.Alerting.Application;
using NodeScope.Modules.Alerting.Domain;
using NodeScope.Modules.Alerting.Infrastructure.Delivery;
using NodeScope.Modules.Alerting.Infrastructure.Endpoints;
using NodeScope.Modules.Alerting.Infrastructure.Persistence;
using NodeScope.Modules.Alerting.Infrastructure.Workers;
using NodeScope.Platform;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Data;

namespace NodeScope.Modules.Alerting.Infrastructure;

public static class AlertingModuleServices
{
    public static IServiceCollection AddAlertingModule(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services.AddSingleton(AlertingOptions.From(key => configuration[key]));
        services.AddDbContext<AlertingDbContext>((provider, options) =>
            options.UseNpgsql(
                provider.GetRequiredService<DatabaseConnectionString>().Value,
                npgsql => npgsql
                    .MapEnum<AlertChannelType>(
                        "AlertChannelType",
                        nameTranslator: ConstantCaseEnumNameTranslator.Instance)
                    .MapEnum<AlertTrigger>(
                        "AlertTrigger",
                        nameTranslator: ConstantCaseEnumNameTranslator.Instance)
                    .MapEnum<AlertSeverity>(
                        "AlertSeverity",
                        nameTranslator: ConstantCaseEnumNameTranslator.Instance)
                    .MapEnum<AlertEventKind>(
                        "AlertEventKind",
                        nameTranslator: ConstantCaseEnumNameTranslator.Instance)
                    .MapEnum<AlertDeliveryStatus>(
                        "AlertDeliveryStatus",
                        nameTranslator: ConstantCaseEnumNameTranslator.Instance)));

        services.AddScoped<IAlertRepository, AlertRepository>();
        services.AddScoped<AlertsService>();
        services.AddScoped<AlertEvaluator>();
        services.AddScoped<IMonitoringAlertSink>(
            provider => provider.GetRequiredService<AlertEvaluator>());
        services.AddScoped<AlertMetricEvaluator>();
        services.AddScoped<AlertDeliveryService>();
        services.AddScoped<IAlertChannelDispatcher, AlertChannelDispatcher>();

        services.AddHttpClient(
            "NodeScopeAlerts",
            client => client.Timeout = TimeSpan.FromSeconds(10));
        services.AddSingleton<PostgresCycleLock>();
        services.AddHostedService<AlertMetricWorker>();
        services.AddHostedService<AlertDeliveryWorker>();
        services.AddHostedService<AlertHeartbeatWorker>();

        return services;
    }

    public static IEndpointRouteBuilder MapAlertingEndpoints(this IEndpointRouteBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        AlertEndpoints.Map(app);
        return app;
    }
}
