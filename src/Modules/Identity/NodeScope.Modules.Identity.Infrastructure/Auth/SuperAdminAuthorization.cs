using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Identity.Infrastructure.Auth;

/// <summary>
/// The super-admin gate on organization provisioning (Node's <c>@RequireSuperAdmin</c>).
/// Organizations have no self-service creation on purpose, so this is the only way one comes
/// into existence.
/// </summary>
public static class SuperAdminAuthorization
{
    /// <summary>Item value for 403 <c>ORG_007</c>, read back by the forbid handler.</summary>
    public const string NotSuperAdmin = "ORG_007";

    public static TBuilder RequireSuperAdmin<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder =>
        builder.RequireAuthorization(policy => policy
            .RequireAuthenticatedUser()
            .AddRequirements(new SuperAdminRequirement()));
}

/// <summary>Marker requirement; <see cref="SuperAdminRequirementHandler"/> evaluates it.</summary>
public sealed class SuperAdminRequirement : IAuthorizationRequirement;

/// <summary>
/// Evaluates <see cref="SuperAdminRequirement"/> against the ticket's claim, recording the
/// failure code so the response carries <c>ORG_007</c> rather than a bare 403.
/// </summary>
public sealed class SuperAdminRequirementHandler : IAuthorizationHandler
{
    public Task HandleAsync(AuthorizationHandlerContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        foreach (var requirement in context.PendingRequirements.OfType<SuperAdminRequirement>().ToList())
        {
            if (context.User.HasClaim(SessionAuthenticationDefaults.SuperAdminClaim, "true"))
            {
                context.Succeed(requirement);
                continue;
            }

            if (context.Resource is HttpContext httpContext)
            {
                httpContext.Items[OrgAuthorization.FailureItemKey] = SuperAdminAuthorization.NotSuperAdmin;
            }

            context.Fail(new AuthorizationFailureReason(this, SuperAdminAuthorization.NotSuperAdmin));
        }

        return Task.CompletedTask;
    }
}
