using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NodeScope.Modules.Identity.Application.Membership;
using NodeScope.Modules.Identity.Application.Organizations;
using NodeScope.Modules.Identity.Application.Permissions;
using NodeScope.Modules.Identity.Application.Users;
using NodeScope.Modules.Identity.Domain;
using NodeScope.Modules.Identity.Infrastructure.Auth;
using NodeScope.Modules.Identity.Infrastructure.Endpoints;
using NodeScope.Modules.Identity.Infrastructure.Persistence;
using NodeScope.Modules.Identity.Infrastructure.Scope;
using NodeScope.Platform;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Data;

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

        // The desktop-auth redirects are built from absolute URLs, same two env vars the
        // Node API requires: the web login page and this API's own public base URL.
        var frontendUrl = configuration["FRONTEND_URL"]
            ?? throw new InvalidOperationException("FRONTEND_URL is required (desktop-auth login redirect)");
        var serverUrl = configuration["BETTER_AUTH_URL"]
            ?? throw new InvalidOperationException("BETTER_AUTH_URL is required (desktop-auth returnTo URL)");
        services.AddSingleton(new DesktopAuthUrls(
            frontendUrl.TrimEnd('/'), serverUrl.TrimEnd('/')));
        services.AddSingleton<DesktopAuthCodeStore>();

        services.AddDbContext<IdentityDbContext>((provider, options) =>
            options.UseNpgsql(
                provider.GetRequiredService<DatabaseConnectionString>().Value,
                npgsql => npgsql
                    .MapEnum<AccountTier>("AccountTier", nameTranslator: ConstantCaseEnumNameTranslator.Instance)
                    .MapEnum<OrgRole>("OrgRole", nameTranslator: ConstantCaseEnumNameTranslator.Instance)
                    .MapEnum<JoinRequestStatus>(
                        "JoinRequestStatus", nameTranslator: ConstantCaseEnumNameTranslator.Instance)));
        services.AddScoped<IPermissionScopeService, PermissionScopeService>();
        services.AddScoped<IOrgMembershipResolver, OrgMembershipResolver>();
        services.AddScoped<IUserRepository, UserRepository>();
        services.AddScoped<IOrganizationRepository, OrganizationRepository>();
        services.AddScoped<UsersService>();
        services.AddScoped<IPermissionsRepository, PermissionsRepository>();
        services.AddScoped<OrganizationsService>();
        services.AddScoped<IMembershipRepository, MembershipRepository>();
        services.AddScoped<PermissionsService>();
        services.AddScoped<MembershipService>();
        services.AddSingleton<Microsoft.AspNetCore.Authorization.IAuthorizationHandler, SuperAdminRequirementHandler>();

        services
            .AddAuthentication(SessionAuthenticationDefaults.SchemeName)
            .AddScheme<SessionAuthenticationOptions, SessionAuthenticationHandler>(
                SessionAuthenticationDefaults.SchemeName,
                options => options.Secret = secret);

        return services;
    }

    public static IEndpointRouteBuilder MapIdentityEndpoints(this IEndpointRouteBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        BetterAuthEndpoints.Map(app);
        DesktopAuthEndpoints.Map(app);
        UsersEndpoints.Map(app);
        OrganizationsEndpoints.Map(app);
        PermissionsEndpoints.Map(app);
        MembershipEndpoints.Map(app);
        return app;
    }
}
