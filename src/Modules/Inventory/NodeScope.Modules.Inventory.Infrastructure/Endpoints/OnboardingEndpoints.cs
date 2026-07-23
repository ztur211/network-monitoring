using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NodeScope.Modules.Inventory.Application.Onboarding;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Inventory.Infrastructure.Endpoints;

/// <summary>
/// <c>/api/v1/onboarding</c> (Node's <c>onboarding.controller.ts</c>). Turn is OWNER/ADMIN-gated
/// because it writes the org's network; skip only touches the caller's own wizard state.
/// </summary>
internal static class OnboardingEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/onboarding/turn", TurnAsync)
            .RequireOrgRoles(OrgRoleNames.Owner, OrgRoleNames.Admin);
        app.MapPost("/api/v1/onboarding/skip", SkipAsync).RequireAuthorization();
    }

    private static async Task<IResult> TurnAsync(
        OnboardingTurnRequest body,
        HttpContext httpContext,
        IOrgContextAccessor org,
        ClaimsPrincipal user,
        OnboardingService service,
        CancellationToken cancellationToken)
    {
        var errors = body.Validate();
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }

        var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var ip = httpContext.Connection.RemoteIpAddress?.ToString() ?? "0.0.0.0";
        return ApiEnvelope.Ok(
            await service.TurnAsync(org.OrgMember!.OrganizationId, userId, ip, body, cancellationToken));
    }

    private static async Task<IResult> SkipAsync(
        ClaimsPrincipal user,
        OnboardingService service,
        CancellationToken cancellationToken)
    {
        await service.SkipAsync(user.FindFirstValue(ClaimTypes.NameIdentifier)!, cancellationToken);
        return ApiEnvelope.Ok(null);
    }
}
