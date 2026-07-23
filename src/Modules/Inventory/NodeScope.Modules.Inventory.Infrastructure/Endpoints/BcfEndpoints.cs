using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NodeScope.Modules.Inventory.Application.Bcf;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Inventory.Infrastructure.Endpoints;

/// <summary>
/// BCF issue tracking (Node's <c>bcf.controller.ts</c>). No role attributes: the services
/// enforce permission themselves, so a MEMBER gets <c>ORG_003</c> on a mutation while reads
/// stay open to anyone in scope.
/// </summary>
internal static class BcfEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var building = app.MapGroup("/api/v1/buildings/{propertyId}/bcf").RequireOrgMember();
        building.MapPost("/import", ImportAsync);
        building.MapGet("/export", ExportAsync);
        building.MapGet("/topics", ListTopicsAsync);
        building.MapPost("/topics", CreateTopicAsync);

        var topics = app.MapGroup("/api/v1/bcf/topics").RequireOrgMember();
        topics.MapGet("/{id}", GetTopicAsync);
        topics.MapPatch("/{id}", PatchTopicAsync);
        topics.MapPost("/{id}/comments", AddCommentAsync);
    }

    private static async Task<IResult> ImportAsync(
        string propertyId,
        HttpRequest request,
        IOrgContextAccessor org,
        BcfArchiveService service,
        CancellationToken cancellationToken)
    {
        if (!request.HasFormContentType)
        {
            throw ApiErrors.MalformedRequest();
        }

        var form = await request.ReadFormAsync(cancellationToken);
        var file = form.Files["file"] ?? throw ApiErrors.MalformedRequest();
        if (file.Length > BcfArchiveService.MaxArchiveBytes)
        {
            throw new ApiException("BCF_001", "BCF_FILE_TOO_LARGE", 413);
        }

        using var buffer = new MemoryStream();
        await using (var content = file.OpenReadStream())
        {
            await content.CopyToAsync(buffer, cancellationToken);
        }

        // Nest POST default, no @HttpCode override on the Node import route.
        return ApiEnvelope.Created(
            await service.ImportAsync(org.OrgMember!, propertyId, buffer.ToArray(), cancellationToken));
    }

    private static async Task<IResult> ExportAsync(
        string propertyId,
        IOrgContextAccessor org,
        BcfArchiveService service,
        CancellationToken cancellationToken)
    {
        var archive = await service.ExportAsync(org.OrgMember!, propertyId, cancellationToken);
        return Results.File(archive, "application/octet-stream", $"{propertyId}-issues.bcfzip");
    }

    private static async Task<IResult> ListTopicsAsync(
        string propertyId,
        IOrgContextAccessor org,
        BcfService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.ListTopicsAsync(org.OrgMember!, propertyId, cancellationToken));

    private static async Task<IResult> CreateTopicAsync(
        string propertyId,
        CreateBcfTopicRequest body,
        IOrgContextAccessor org,
        BcfService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Created(await service.CreateTopicAsync(org.OrgMember!, propertyId, body, cancellationToken));

    private static async Task<IResult> GetTopicAsync(
        string id,
        IOrgContextAccessor org,
        BcfService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.GetTopicAsync(org.OrgMember!, id, cancellationToken));

    private static async Task<IResult> PatchTopicAsync(
        string id,
        JsonElement body,
        IOrgContextAccessor org,
        BcfService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(
            await service.PatchTopicAsync(org.OrgMember!, id, PatchBcfTopicRequest.Parse(body), cancellationToken));

    private static async Task<IResult> AddCommentAsync(
        string id,
        AddBcfCommentRequest body,
        IOrgContextAccessor org,
        BcfService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Created(await service.AddCommentAsync(org.OrgMember!, id, body, cancellationToken));
}
