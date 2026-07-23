namespace NodeScope.Modules.Inventory.Domain.Bcf;

// "Guid" is the BCF 2.1 field name, carried through from the file format to the wire, so the
// members below keep it despite CA1720's general advice about type names in identifiers.
#pragma warning disable CA1720

/// <summary>A BCF viewpoint camera. <c>Perspective</c> carries a field of view, orthographic a scale.</summary>
public sealed record BcfCamera(
    string Kind,
    IReadOnlyList<double> Position,
    IReadOnlyList<double> Direction,
    IReadOnlyList<double> Up,
    double? FieldOfView,
    double? ViewToWorldScale);

/// <summary>Which elements a viewpoint selects and which it hides.</summary>
public sealed record BcfComponents(IReadOnlyList<string> Selection, BcfVisibility Visibility);

public sealed record BcfVisibility(bool DefaultVisibility, IReadOnlyList<string> Exceptions);

/// <summary>A viewpoint as it exists in an archive: camera, components, and an optional snapshot.</summary>
public sealed record BcfViewpointData(
    string Guid,
    bool IsPrimary,
    BcfCamera Camera,
    BcfComponents Components,
    ReadOnlyMemory<byte>? SnapshotPng);

public sealed record BcfCommentData(
    string Guid,
    string Comment,
    string Author,
    DateTime Date,
    string? ViewpointGuid);

/// <summary>One topic of a BCF archive.</summary>
public sealed record BcfTopicData(
    string Guid,
    string Title,
    string? TopicType,
    string? TopicStatus,
    string? Priority,
    IReadOnlyList<string> Labels,
    string CreationAuthor,
    DateTime CreationDate,
    string? AssignedTo,
    string? Description,
    IReadOnlyList<BcfCommentData> Comments,
    IReadOnlyList<BcfViewpointData> Viewpoints);
#pragma warning restore CA1720
