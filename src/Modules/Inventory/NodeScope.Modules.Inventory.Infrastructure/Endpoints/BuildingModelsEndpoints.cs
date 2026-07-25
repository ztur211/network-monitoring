using System.Globalization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using NodeScope.Modules.Inventory.Application.BuildingModels;
using NodeScope.Modules.Inventory.Application.Export;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Inventory.Infrastructure.Endpoints;

/// <summary>
/// <c>/api/v1/buildings/:propertyId/model</c> (Node's <c>building-models.controller.ts</c>) plus
/// the IFC export. File responses bypass the JSON envelope and stream the raw bytes.
/// </summary>
internal static class BuildingModelsEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var reads = app.MapGroup("/api/v1/buildings/{propertyId}").RequireOrgMember();
        reads.MapGet("/model", GetModelAsync);
        reads.MapGet("/model/versions", ListVersionsAsync);
        reads.MapGet("/model/active/file", DownloadActiveAsync);
        reads.MapGet("/model/active/geometry", DownloadActiveGeometryAsync);
        reads.MapGet("/model/active/metadata", GetActiveMetadataAsync);
        reads.MapGet("/model/versions/{versionId}/file", DownloadVersionAsync);
        reads.MapGet("/model/versions/{versionId}/geometry", DownloadVersionGeometryAsync);
        reads.MapGet("/model/versions/{versionId}/metadata", GetVersionMetadataAsync);
        reads.MapGet("/export/ifc", ExportIfcAsync);

        var writes = app.MapGroup("/api/v1/buildings/{propertyId}/model")
            .RequireOrgRoles(OrgRoleNames.Owner, OrgRoleNames.Admin);
        writes.MapPost("/versions", UploadAsync);
        writes.MapPut("/versions/{versionId}/geometry", UploadGeometryAsync);
        writes.MapPut("/versions/{versionId}/metadata", UploadMetadataAsync);
        writes.MapPut("/active", ActivateAsync);
        writes.MapDelete("/versions/{versionId}", DeleteVersionAsync);
    }

    private static async Task<IResult> GetModelAsync(
        string propertyId,
        IOrgContextAccessor org,
        BuildingModelsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(propertyId);
        return ApiEnvelope.Ok(await service.GetModelAsync(org.OrgMember!, propertyId, cancellationToken));
    }

    private static async Task<IResult> ListVersionsAsync(
        string propertyId,
        IOrgContextAccessor org,
        BuildingModelsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(propertyId);
        return ApiEnvelope.Ok(await service.ListVersionsAsync(org.OrgMember!, propertyId, cancellationToken));
    }

    /// <summary>
    /// The IFC arrives as the raw request body (the client sets octet-stream), so the body is
    /// read straight off the request rather than through model binding.
    /// </summary>
    private static async Task<IResult> UploadAsync(
        string propertyId,
        string? fileName,
        string? units,
        bool? activate,
        HttpContext httpContext,
        IOrgContextAccessor org,
        BuildingModelsService service,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(propertyId);
        var maxBytes = long.TryParse(
            configuration["MODEL_MAX_BYTES"], NumberStyles.Integer, CultureInfo.InvariantCulture, out var configured)
            ? configured
            : BuildingModelsService.DefaultMaxBytes;
        var version = await service.UploadVersionAsync(
            org.OrgMember!,
            propertyId,
            fileName,
            units,
            httpContext.Request.Body,
            maxBytes,
            activate ?? true,
            cancellationToken);
        return ApiEnvelope.Created(version);
    }

    private static async Task<IResult> UploadGeometryAsync(
        string propertyId,
        string versionId,
        HttpContext httpContext,
        IOrgContextAccessor org,
        BuildingModelsService service,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(propertyId);
        RouteParams.RequireUuid(versionId);
        var maxBytes = long.TryParse(
            configuration["MODEL_MAX_BYTES"], NumberStyles.Integer, CultureInfo.InvariantCulture, out var configured)
            ? configured
            : BuildingModelsService.DefaultMaxBytes;
        return ApiEnvelope.Ok(await service.UploadGeometryAsync(
            org.OrgMember!,
            propertyId,
            versionId,
            httpContext.Request.Body,
            maxBytes,
            cancellationToken));
    }

    private static async Task<IResult> ActivateAsync(
        string propertyId,
        ActivateVersionRequest body,
        IOrgContextAccessor org,
        BuildingModelsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(propertyId);
        var errors = body.Validate();
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }

        return ApiEnvelope.Ok(
            await service.ActivateVersionAsync(org.OrgMember!, propertyId, body.VersionId!, cancellationToken));
    }

    private static async Task<IResult> UploadMetadataAsync(
        string propertyId,
        string versionId,
        UploadBuildingModelMetadataRequest body,
        IOrgContextAccessor org,
        BuildingModelsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(propertyId);
        RouteParams.RequireUuid(versionId);
        var errors = body.Validate();
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }

        return ApiEnvelope.Ok(await service.UploadMetadataAsync(
            org.OrgMember!,
            propertyId,
            versionId,
            body,
            cancellationToken));
    }

    private static async Task<IResult> DeleteVersionAsync(
        string propertyId,
        string versionId,
        IOrgContextAccessor org,
        BuildingModelsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(propertyId);
        RouteParams.RequireUuid(versionId);
        await service.DeleteVersionAsync(org.OrgMember!, propertyId, versionId, cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> DownloadActiveAsync(
        string propertyId,
        IOrgContextAccessor org,
        BuildingModelsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(propertyId);
        var file = await service.GetActiveFileAsync(org.OrgMember!, propertyId, cancellationToken);
        return FileResult(file);
    }

    private static async Task<IResult> DownloadVersionAsync(
        string propertyId,
        string versionId,
        IOrgContextAccessor org,
        BuildingModelsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(propertyId);
        RouteParams.RequireUuid(versionId);
        var file = await service.GetVersionFileAsync(org.OrgMember!, propertyId, versionId, cancellationToken);
        return FileResult(file);
    }

    private static async Task<IResult> DownloadActiveGeometryAsync(
        string propertyId,
        IOrgContextAccessor org,
        BuildingModelsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(propertyId);
        return GeometryResult(
            await service.GetActiveGeometryAsync(org.OrgMember!, propertyId, cancellationToken));
    }

    private static async Task<IResult> DownloadVersionGeometryAsync(
        string propertyId,
        string versionId,
        IOrgContextAccessor org,
        BuildingModelsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(propertyId);
        RouteParams.RequireUuid(versionId);
        return GeometryResult(await service.GetVersionGeometryAsync(
            org.OrgMember!, propertyId, versionId, cancellationToken));
    }

    private static async Task<IResult> GetActiveMetadataAsync(
        string propertyId,
        IOrgContextAccessor org,
        BuildingModelsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(propertyId);
        return ApiEnvelope.Ok(
            await service.GetActiveMetadataAsync(org.OrgMember!, propertyId, cancellationToken));
    }

    private static async Task<IResult> GetVersionMetadataAsync(
        string propertyId,
        string versionId,
        IOrgContextAccessor org,
        BuildingModelsService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(propertyId);
        RouteParams.RequireUuid(versionId);
        return ApiEnvelope.Ok(await service.GetVersionMetadataAsync(
            org.OrgMember!, propertyId, versionId, cancellationToken));
    }

    private static async Task<IResult> ExportIfcAsync(
        string propertyId,
        IOrgContextAccessor org,
        IfcExportService service,
        CancellationToken cancellationToken)
    {
        RouteParams.RequireUuid(propertyId);
        var export = await service.ExportBuildingAsync(
            org.OrgMember!, propertyId, DateTime.UtcNow, cancellationToken);
        return Results.File(export.Content.ToArray(), "application/x-step", export.FileName);
    }

    private static IResult FileResult(ModelFile file) =>
        Results.File(file.Content, "application/octet-stream", file.FileName);

    private static IResult GeometryResult(ModelFile file) =>
        Results.File(file.Content, "application/vnd.xbim.wexbim", file.FileName);
}
