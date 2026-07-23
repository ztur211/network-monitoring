using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NodeScope.Modules.Assistant.Application;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Assistant.Infrastructure;

/// <summary>
/// <c>/api/v1/ai</c> (Node's <c>ai.controller.ts</c>). Chat itself is realtime-only, so the
/// HTTP surface is just the usage read and the conversation delete.
/// </summary>
internal static class AiEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/ai").RequireAuthorization();

        group.MapGet("/usage", GetUsageAsync);
        group.MapDelete("/conversation/{conversationId}", DeleteConversationAsync);
    }

    private static async Task<IResult> GetUsageAsync(
        ClaimsPrincipal user,
        AiService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(
            await service.GetUsageAsync(user.FindFirstValue(ClaimTypes.NameIdentifier)!, cancellationToken));

    private static async Task<IResult> DeleteConversationAsync(
        string conversationId,
        ClaimsPrincipal user,
        AiService service,
        CancellationToken cancellationToken)
    {
        await service.DeleteConversationAsync(
            user.FindFirstValue(ClaimTypes.NameIdentifier)!, conversationId, cancellationToken);
        return ApiEnvelope.Ok(null);
    }
}
