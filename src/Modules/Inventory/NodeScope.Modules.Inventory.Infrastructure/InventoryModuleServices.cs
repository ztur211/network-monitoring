using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using NodeScope.Modules.Inventory.Application.BuildingModels;
using NodeScope.Modules.Inventory.Application.Clients;
using NodeScope.Modules.Inventory.Application.Devices;
using NodeScope.Modules.Inventory.Application.Export;
using NodeScope.Modules.Inventory.Application.Links;
using NodeScope.Modules.Inventory.Application.Map;
using NodeScope.Modules.Inventory.Application.Networks;
using NodeScope.Modules.Inventory.Application.Onboarding;
using NodeScope.Modules.Inventory.Application.Properties;
using NodeScope.Modules.Inventory.Domain;
using NodeScope.Modules.Inventory.Infrastructure.Endpoints;
using NodeScope.Modules.Inventory.Infrastructure.Onboarding;
using NodeScope.Modules.Inventory.Infrastructure.Persistence;
using NodeScope.Platform;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Data;

namespace NodeScope.Modules.Inventory.Infrastructure;

/// <summary>The Inventory module's registration + endpoint-mapping pair (Decision 6).</summary>
public static class InventoryModuleServices
{
    public static IServiceCollection AddInventoryModule(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services.AddDbContext<InventoryDbContext>((provider, options) =>
            options.UseNpgsql(
                provider.GetRequiredService<DatabaseConnectionString>().Value,
                npgsql => npgsql
                    .MapEnum<PropertyType>("PropertyType", nameTranslator: ConstantCaseEnumNameTranslator.Instance)
                    .MapEnum<DeviceCategory>("DeviceCategory", nameTranslator: ConstantCaseEnumNameTranslator.Instance)
                    .MapEnum<DeviceMobility>("DeviceMobility", nameTranslator: ConstantCaseEnumNameTranslator.Instance)
                    .MapEnum<ConnectionType>("ConnectionType", nameTranslator: ConstantCaseEnumNameTranslator.Instance)));

        services.AddScoped<IPropertyRepository, PropertyRepository>();
        services.AddScoped<IDeviceRepository, DeviceRepository>();
        services.AddScoped<IOrgNamingPolicyReader, OrgNamingPolicyReader>();
        services.AddScoped<IBuildingModelRepository, BuildingModelRepository>();
        services.AddScoped<INetworkPropertyRepository, NetworkPropertyRepository>();
        services.AddScoped<INetworkRepository, NetworkRepository>();
        services.AddScoped<ICircuitRepository, CircuitRepository>();
        services.AddScoped<IFiberRunRepository, FiberRunRepository>();
        services.AddScoped<IConnectionRepository, ConnectionRepository>();
        services.AddScoped<IMapRepository, MapRepository>();
        services.AddScoped<IUserMetricsRepository, UserMetricsRepository>();
        services.AddMemoryCache();
        services.AddScoped<IOnboardingStateStore, MemoryOnboardingStateStore>();
        services.AddScoped<IOnboardingCompletionStore, OnboardingCompletionStore>();
        services.AddHttpClient<IGeocoder, NominatimGeocoder>();
        // The Assistant module registers a provider-driven narrator later in composition, which
        // wins; this canned copy is what serves until then and whenever the provider is down.
        services.TryAddScoped<IOnboardingNarrator, FallbackOnboardingNarrator>();
        services.AddScoped<ContainmentService>();
        services.AddScoped<PropertiesService>();
        services.AddScoped<NetworkPropertyService>();
        services.AddScoped<NetworksService>();
        services.AddScoped<DevicesService>();
        services.AddScoped<NameSuggestionService>();
        services.AddScoped<SpatialService>();
        services.AddScoped<LinkEndpoints>();
        services.AddScoped<CircuitsService>();
        services.AddScoped<FiberRunsService>();
        services.AddScoped<ConnectionsService>();
        services.AddScoped<MapService>();
        services.AddScoped<ClientsService>();
        services.AddScoped<OnboardingService>();
        services.AddScoped<BuildingModelsService>();
        services.AddScoped<IfcExportService>();

        return services;
    }

    public static IEndpointRouteBuilder MapInventoryEndpoints(this IEndpointRouteBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        PropertiesEndpoints.Map(app);
        NetworkPropertyEndpoints.Map(app);
        NetworksEndpoints.Map(app);
        DevicesEndpoints.Map(app);
        SpatialEndpoints.Map(app);
        CircuitsEndpoints.Map(app);
        FiberRunsEndpoints.Map(app);
        ConnectionsEndpoints.Map(app);
        MapEndpoints.Map(app);
        ClientsEndpoints.Map(app);
        OnboardingEndpoints.Map(app);
        BuildingModelsEndpoints.Map(app);
        return app;
    }
}
