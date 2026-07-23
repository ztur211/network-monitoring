using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Platform.Http;

/// <summary>
/// Org-membership authorization, ported from the Node API's <c>OrgRoleGuard</c> and the
/// <c>@OrgId()</c>/<c>@OrgMember()</c> parameter decorators. It runs as an authorization
/// requirement (before model binding, like a Nest guard runs before pipes), so a role
/// failure produces 403 even when the request body would not validate.
/// </summary>
public static class OrgAuthorization
{
    /// <summary>
    /// <c>HttpContext.Items</c> key under which the requirement handler records why
    /// authorization failed, so the forbid response can carry the right error code.
    /// </summary>
    public const string FailureItemKey = "nodescope.orgAuthFailure";

    /// <summary>Item value for 403 <c>ORG_002 NOT_AN_ORG_MEMBER</c>.</summary>
    public const string NotAnOrgMember = "ORG_002";

    /// <summary>Item value for 403 <c>ORG_003 INSUFFICIENT_ORG_ROLE</c>.</summary>
    public const string InsufficientRole = "ORG_003";

    /// <summary>Requires an authenticated session whose user belongs to an organization.</summary>
    public static TBuilder RequireOrgMember<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder => builder.RequireOrgRoles();

    /// <summary>
    /// Requires an authenticated org member holding one of <paramref name="roles"/>
    /// (membership only when empty). Missing membership is <c>ORG_002</c>, wrong role
    /// <c>ORG_003</c>, no session <c>AUTH_002</c>.
    /// </summary>
    public static TBuilder RequireOrgRoles<TBuilder>(this TBuilder builder, params string[] roles)
        where TBuilder : IEndpointConventionBuilder =>
        builder.RequireAuthorization(policy => policy
            .RequireAuthenticatedUser()
            .AddRequirements(new OrgRolesRequirement(roles)));
}

/// <summary>An empty role list means "any role, but membership is required".</summary>
public sealed class OrgRolesRequirement : IAuthorizationRequirement
{
    public OrgRolesRequirement(IReadOnlyList<string> roles)
    {
        Roles = roles;
    }

    public IReadOnlyList<string> Roles { get; }
}

/// <summary>
/// Evaluates <see cref="OrgRolesRequirement"/> against the request's resolved org context.
/// Implements <see cref="IAuthorizationHandler"/> directly rather than inheriting
/// <c>AuthorizationHandler&lt;T&gt;</c> (Decision 6: no reuse inheritance).
/// </summary>
public sealed class OrgRequirementHandler : IAuthorizationHandler
{
    public Task HandleAsync(AuthorizationHandlerContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        foreach (var requirement in context.PendingRequirements.OfType<OrgRolesRequirement>().ToList())
        {
            if (context.Resource is not HttpContext httpContext)
            {
                continue;
            }

            var member = httpContext.RequestServices.GetRequiredService<IOrgContextAccessor>().OrgMember;
            if (member is null)
            {
                httpContext.Items[OrgAuthorization.FailureItemKey] = OrgAuthorization.NotAnOrgMember;
                context.Fail(new AuthorizationFailureReason(this, OrgAuthorization.NotAnOrgMember));
            }
            else if (requirement.Roles.Count > 0 && !member.HasRole([.. requirement.Roles]))
            {
                httpContext.Items[OrgAuthorization.FailureItemKey] = OrgAuthorization.InsufficientRole;
                context.Fail(new AuthorizationFailureReason(this, OrgAuthorization.InsufficientRole));
            }
            else
            {
                context.Succeed(requirement);
            }
        }

        return Task.CompletedTask;
    }
}
