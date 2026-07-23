using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Net.Http.Headers;
using NodeScope.Modules.Inventory.Application.Clients;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Inventory.Infrastructure.Endpoints;

/// <summary><c>/api/v1/clients</c> (Node's <c>clients.controller.ts</c>).</summary>
internal static class ClientsEndpoints
{
    public static void Map(IEndpointRouteBuilder app) =>
        app.MapGet("/api/v1/clients", GetAsync).RequireOrgMember();

    private static async Task<IResult> GetAsync(
        HttpContext httpContext,
        IOrgContextAccessor org,
        ClaimsPrincipal user,
        ClientsService service,
        CancellationToken cancellationToken)
    {
        var userAgent = httpContext.Request.Headers[HeaderNames.UserAgent].ToString();
        var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
        return ApiEnvelope.Ok(
            await service.GetAsync(org.OrgMember!.OrganizationId, userId, userAgent, cancellationToken));
    }
}
