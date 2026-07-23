using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NodeScope.Modules.Identity.Application.Users;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Identity.Infrastructure.Endpoints;

/// <summary><c>/api/v1/users</c> (Node's <c>users.controller.ts</c>).</summary>
internal static class UsersEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/users").RequireAuthorization();

        group.MapGet("/me", GetMeAsync);
        group.MapPatch("/me", UpdateMeAsync);
        group.MapPost("/location", SetLocationAsync);
        group.MapGet("/me/preferences", GetPreferencesAsync);
        group.MapPut("/me/preferences", UpdatePreferencesAsync);
        // Org-scoped, unlike the rest of the group: the sources belong to a membership.
        app.MapGet("/api/v1/users/me/data-sources", GetDataSourcesAsync).RequireOrgMember();
    }

    private static async Task<IResult> GetMeAsync(
        ClaimsPrincipal user,
        UsersService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.GetMeAsync(UserId(user), cancellationToken));

    private static async Task<IResult> UpdateMeAsync(
        UpdateMeRequest body,
        ClaimsPrincipal user,
        UsersService service,
        CancellationToken cancellationToken)
    {
        Validate(body.Validate());
        return ApiEnvelope.Ok(await service.UpdateMeAsync(UserId(user), body, cancellationToken));
    }

    private static async Task<IResult> SetLocationAsync(
        SetLocationRequest body,
        ClaimsPrincipal user,
        UsersService service,
        CancellationToken cancellationToken)
    {
        Validate(body.Validate());
        return ApiEnvelope.Ok(await service.SetLocationAsync(UserId(user), body, cancellationToken));
    }

    private static async Task<IResult> GetDataSourcesAsync(
        IOrgContextAccessor org,
        ClaimsPrincipal user,
        UsersService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(
            await service.GetDataSourcesAsync(org.OrgMember!.OrganizationId, UserId(user), cancellationToken));

    private static async Task<IResult> GetPreferencesAsync(
        ClaimsPrincipal user,
        UsersService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.GetPreferencesAsync(UserId(user), cancellationToken));

    private static async Task<IResult> UpdatePreferencesAsync(
        JsonElement body,
        ClaimsPrincipal user,
        UsersService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.UpdatePreferencesAsync(UserId(user), body, cancellationToken));

    private static string UserId(ClaimsPrincipal user) => user.FindFirstValue(ClaimTypes.NameIdentifier)!;

    private static void Validate(IReadOnlyList<string> errors)
    {
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }
    }
}
