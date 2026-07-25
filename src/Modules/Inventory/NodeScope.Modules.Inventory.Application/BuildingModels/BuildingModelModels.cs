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

/// <summary>Metadata returned after a version's wexBIM render artifact lands.</summary>
public sealed record BuildingModelGeometryDto(
    string VersionId,
    string Format,
    string ContentHash,
    int SizeBytes);

/// <summary>Portable identity and display data for one tessellated IFC product.</summary>
public sealed record BuildingModelElementDto(
    int ProductLabel,
    string GlobalId,
    string TypeName,
    string? Name);

/// <summary>
/// Canonical metadata artifact paired with one immutable IFC version. Format
/// versioning keeps future property-set additions backward compatible.
/// </summary>
public sealed record BuildingModelMetadataDto(
    string VersionId,
    int FormatVersion,
    IReadOnlyList<BuildingModelElementDto> Elements);

/// <summary>Receipt proving which canonical metadata bytes the appliance stored.</summary>
public sealed record BuildingModelMetadataReceiptDto(
    string VersionId,
    int FormatVersion,
    string ContentHash,
    int SizeBytes,
    int ElementCount);

/// <summary>Body of the upload-time IFC product index request.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class UploadBuildingModelMetadataRequest
{
    public const int MaximumElements = 1_000_000;

    public int FormatVersion { get; init; }

    public IReadOnlyList<BuildingModelElementDto>? Elements { get; init; }

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        if (FormatVersion != 1)
        {
            errors.Add("formatVersion must equal 1");
        }

        if (Elements is null)
        {
            errors.Add("elements must be an array");
            return errors;
        }

        if (Elements.Count > MaximumElements)
        {
            errors.Add($"elements must contain no more than {MaximumElements} items");
            return errors;
        }

        var labels = new HashSet<int>();
        var globalIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var element in Elements)
        {
            if (element is null)
            {
                errors.Add("elements must not contain null values");
                continue;
            }

            if (element.ProductLabel <= 0)
            {
                errors.Add("element productLabel must be greater than zero");
            }
            else if (!labels.Add(element.ProductLabel))
            {
                errors.Add($"element productLabel {element.ProductLabel} must be unique");
            }

            if (!IsIfcGlobalId(element.GlobalId))
            {
                errors.Add("element globalId must be a 22-character IFC GlobalId");
            }
            else if (!globalIds.Add(element.GlobalId))
            {
                errors.Add($"element globalId {element.GlobalId} must be unique");
            }

            if (string.IsNullOrWhiteSpace(element.TypeName) || element.TypeName.Length > 128)
            {
                errors.Add("element typeName must contain 1 to 128 characters");
            }

            if (element.Name?.Length > 512)
            {
                errors.Add("element name must contain no more than 512 characters");
            }

            if (errors.Count >= 20)
            {
                errors.Add("metadata contains additional invalid elements");
                break;
            }
        }

        return errors;
    }

    private static bool IsIfcGlobalId(string value) =>
        value is { Length: 22 }
        && value.All(static character =>
            char.IsAsciiLetterOrDigit(character) || character is '_' or '$');
}

/// <summary>An opened model file: the bytes plus what the download headers need.</summary>
public sealed record ModelFile(Stream Content, string FileName, int SizeBytes);
