using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NodeScope.Modules.Identity.Infrastructure.Auth;
using NodeScope.Modules.Identity.Infrastructure.Persistence;
using NodeScope.Modules.Identity.Infrastructure.Scope;
using NodeScope.Platform;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Identity.Infrastructure;

/// <summary>
/// The Identity module's one registration extension (Decision 6). The module's HTTP surface
/// is ported last in step 4, but its authentication/authorization infrastructure - the
/// session scheme, org-context resolution, and F3 scoping - must exist first because every
/// other module's endpoints depend on it.
/// </summary>
public static class IdentityModuleServices
{
    public static IServiceCollection AddIdentityModule(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        var secret = configuration["BETTER_AUTH_SECRET"]
            ?? throw new InvalidOperationException("BETTER_AUTH_SECRET is required (sessions are HMAC-signed)");

        services.AddDbContext<IdentityDbContext>((provider, options) =>
            options.UseNpgsql(provider.GetRequiredService<DatabaseConnectionString>().Value));
        services.AddScoped<IPermissionScopeService, PermissionScopeService>();

        services
            .AddAuthentication(SessionAuthenticationDefaults.SchemeName)
            .AddScheme<SessionAuthenticationOptions, SessionAuthenticationHandler>(
                SessionAuthenticationDefaults.SchemeName,
                options => options.Secret = secret);

        return services;
    }
}
