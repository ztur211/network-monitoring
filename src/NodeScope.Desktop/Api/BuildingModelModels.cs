namespace NodeScope.Desktop.Api;

/// <summary>A property tree row as needed by the 3D building selector.</summary>
internal sealed record PropertySummary(
    string Id,
    string? ParentId,
    string Type,
    string Name,
    string? Code);

/// <summary>The model row that identifies a building's active immutable version.</summary>
internal sealed record BuildingModelSummary(
    string Id,
    string PropertyId,
    string Name,
    string? ActiveVersionId,
    int Version);

/// <summary>The version metadata returned after an immutable IFC upload lands.</summary>
internal sealed record BuildingModelVersionSummary(
    string Id,
    string BuildingModelId,
    int VersionNumber,
    string FileName,
    string ContentHash,
    int SizeBytes,
    string? Units,
    string? UploadedByMemberId,
    DateTime CreatedAt);

/// <summary>The appliance's receipt for a stored wexBIM artifact.</summary>
internal sealed record BuildingModelGeometrySummary(
    string VersionId,
    string Format,
    string ContentHash,
    int SizeBytes);

/// <summary>The wexBIM product label mapped back to its durable IFC identity.</summary>
internal sealed record BuildingModelElementMetadata(
    int ProductLabel,
    string GlobalId,
    string TypeName,
    string? Name);

/// <summary>The portable IFC element index paired with an immutable model version.</summary>
internal sealed record BuildingModelMetadataSummary(
    string VersionId,
    int FormatVersion,
    IReadOnlyList<BuildingModelElementMetadata> Elements);

/// <summary>The appliance receipt for a canonical IFC element index.</summary>
internal sealed record BuildingModelMetadataReceipt(
    string VersionId,
    int FormatVersion,
    string ContentHash,
    int SizeBytes,
    int ElementCount);
