using System.Text.Json.Serialization;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.BuildingModels;

/// <summary>BuildingModel wire DTO.</summary>
public sealed record BuildingModelDto(
    string Id,
    string OrganizationId,
    string PropertyId,
    string Name,
    string? ActiveVersionId,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt);

/// <summary>Version wire DTO. <c>storageKey</c> is internal and never leaves the API.</summary>
public sealed record BuildingModelVersionDto(
    string Id,
    string BuildingModelId,
    int VersionNumber,
    string FileName,
    string ContentHash,
    int SizeBytes,
    string? Units,
    string? UploadedByMemberId,
    DateTime CreatedAt);

/// <summary>Body of <c>PUT /api/v1/buildings/:propertyId/model/active</c>.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class ActivateVersionRequest
{
    public string? VersionId { get; init; }

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        RequestValidation.RequireNonEmptyString(errors, VersionId, "versionId");
        return errors;
    }
}

/// <summary>A BuildingModel row as the application layer sees it.</summary>
public sealed record BuildingModelRecord(
    string Id,
    string OrganizationId,
    string PropertyId,
    string Name,
    string? ActiveVersionId,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt)
{
    public BuildingModelDto ToDto() => new(
        Id, OrganizationId, PropertyId, Name, ActiveVersionId, Version, CreatedAt, UpdatedAt);
}

/// <summary>A BuildingModelVersion row, including the internal storage key.</summary>
public sealed record BuildingModelVersionRecord(
    string Id,
    string OrganizationId,
    string BuildingModelId,
    int VersionNumber,
    string StorageKey,
    string FileName,
    string ContentHash,
    int SizeBytes,
    string? Units,
    string? UploadedByMemberId,
    DateTime CreatedAt)
{
    public BuildingModelVersionDto ToDto() => new(
        Id, BuildingModelId, VersionNumber, FileName, ContentHash, SizeBytes, Units, UploadedByMemberId, CreatedAt);
}

/// <summary>Fields of a new version row (written only after its object has landed).</summary>
public sealed record NewBuildingModelVersion(
    string Id,
    string OrganizationId,
    string BuildingModelId,
    int VersionNumber,
    string StorageKey,
    string FileName,
    string ContentHash,
    int SizeBytes,
    string? Units,
    string? UploadedByMemberId);

/// <summary>An opened model file: the bytes plus what the download headers need.</summary>
public sealed record ModelFile(Stream Content, string FileName, int SizeBytes);
