using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NodeScope.Modules.Inventory.Application.Networks;
using NodeScope.Modules.Inventory.Application.Properties;
using NodeScope.Modules.Inventory.Domain;
using NodeScope.Modules.Inventory.Infrastructure.Endpoints;
using NodeScope.Modules.Inventory.Infrastructure.Persistence;
using NodeScope.Platform;
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
                npgsql => npgsql.MapEnum<PropertyType>(
                    "PropertyType", nameTranslator: ConstantCaseEnumNameTranslator.Instance)));

        services.AddScoped<IPropertyRepository, PropertyRepository>();
        services.AddScoped<INetworkPropertyRepository, NetworkPropertyRepository>();
        services.AddScoped<INetworkRepository, NetworkRepository>();
        services.AddScoped<ContainmentService>();
        services.AddScoped<PropertiesService>();
        services.AddScoped<NetworkPropertyService>();
        services.AddScoped<NetworksService>();

        return services;
    }

    public static IEndpointRouteBuilder MapInventoryEndpoints(this IEndpointRouteBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        PropertiesEndpoints.Map(app);
        NetworkPropertyEndpoints.Map(app);
        NetworksEndpoints.Map(app);
        return app;
    }
}
