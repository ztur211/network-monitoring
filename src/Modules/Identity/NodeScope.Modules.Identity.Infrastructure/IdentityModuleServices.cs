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
            .AddScheme<Microsoft.AspNetCore.Authentication.AuthenticationSchemeOptions, SessionAuthenticationHandler>(
                SessionAuthenticationDefaults.SchemeName,
                configureOptions: null);

        return services;
    }

    public static IEndpointRouteBuilder MapIdentityEndpoints(this IEndpointRouteBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        AuthEndpoints.Map(app);
        UsersEndpoints.Map(app);
        OrganizationsEndpoints.Map(app);
        PermissionsEndpoints.Map(app);
        MembershipEndpoints.Map(app);
        return app;
    }
}
