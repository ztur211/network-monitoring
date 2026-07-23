using System.Text.Json;
using NodeScope.Modules.Inventory.Domain.Bcf;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Bcf;

// "Guid" is the BCF 2.1 field name, carried through from the file format to the wire, so the
// members below keep it despite CA1720's general advice about type names in identifiers.
#pragma warning disable CA1720

/// <summary>Topic list shape: no comment bodies or viewpoint blobs, just the counts and links.</summary>
public sealed record BcfTopicSummaryDto(
    string Id,
    string OrganizationId,
    string PropertyId,
    string Guid,
    string Title,
    string? TopicType,
    string? TopicStatus,
    string? Priority,
    IReadOnlyList<string> Labels,
    string CreationAuthor,
    DateTime CreationDate,
    string? ModifiedAuthor,
    DateTime? ModifiedDate,
    string? AssignedTo,
    DateTime? DueDate,
    string? Description,
    int Version,
    int CommentCount,
    IReadOnlyList<string> DeviceIds,
    DateTime CreatedAt,
    DateTime UpdatedAt);

/// <summary>Full topic: the summary plus its comments and viewpoints.</summary>
public sealed record BcfTopicDto(
    string Id,
    string OrganizationId,
    string PropertyId,
    string Guid,
    string Title,
    string? TopicType,
    string? TopicStatus,
    string? Priority,
    IReadOnlyList<string> Labels,
    string CreationAuthor,
    DateTime CreationDate,
    string? ModifiedAuthor,
    DateTime? ModifiedDate,
    string? AssignedTo,
    DateTime? DueDate,
    string? Description,
    int Version,
    int CommentCount,
    IReadOnlyList<string> DeviceIds,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    IReadOnlyList<BcfCommentDto> Comments,
    IReadOnlyList<BcfViewpointDto> Viewpoints);

public sealed record BcfCommentDto(
    string Id,
    string Guid,
    string Comment,
    string Author,
    DateTime Date,
    string? ViewpointGuid);

/// <summary>A viewpoint as clients see it - the snapshot is fetched through the export, never inlined.</summary>
public sealed record BcfViewpointDto(
    string Id,
    string Guid,
    BcfCamera Camera,
    BcfComponents Components,
    IReadOnlyList<object> ClippingPlanes,
    bool IsPrimary,
    bool HasSnapshot);

/// <summary>
/// Body of <c>POST buildings/:propertyId/bcf/topics</c>. The Node DTO is a plain interface with
/// no validation decorators, so the pipe never inspected it - unknown members are accepted here
/// too, deliberately.
/// </summary>
public sealed class CreateBcfTopicRequest
{
    public string? Title { get; init; }

    public string? TopicType { get; init; }

    public string? TopicStatus { get; init; }

    public string? Priority { get; init; }

    public IReadOnlyList<string>? Labels { get; init; }

    public string? AssignedTo { get; init; }

    public DateTime? DueDate { get; init; }

    public string? Description { get; init; }

    public IReadOnlyList<CreateBcfViewpointRequest>? Viewpoints { get; init; }
}

public sealed class CreateBcfViewpointRequest
{
    public string? Guid { get; init; }

    public BcfCamera? Camera { get; init; }

    public BcfComponents? Components { get; init; }

    public bool? IsPrimary { get; init; }

    /// <summary>Present-but-empty must stay distinguishable from absent: empty is an invalid PNG.</summary>
    public string? SnapshotPngBase64 { get; init; }
}

/// <summary>Body of <c>POST bcf/topics/:id/comments</c>.</summary>
public sealed class AddBcfCommentRequest
{
    public string? Comment { get; init; }

    public string? ViewpointGuid { get; init; }
}

/// <summary>
/// Body of <c>PATCH bcf/topics/:id</c>, kept as raw JSON because absence and an explicit null
/// mean different things here: an absent member leaves the column alone, a null clears it.
/// </summary>
public sealed record PatchBcfTopicRequest(int BaseVersion, IReadOnlyDictionary<string, JsonElement> Fields)
{
    private static readonly string[] Patchable =
        ["title", "topicType", "topicStatus", "priority", "labels", "assignedTo", "dueDate", "description"];

    public static PatchBcfTopicRequest Parse(JsonElement body)
    {
        if (body.ValueKind != JsonValueKind.Object
            || !body.TryGetProperty("baseVersion", out var baseVersion)
            || !baseVersion.TryGetInt32(out var version))
        {
            throw ApiErrors.Validation(["baseVersion must be an integer number"]);
        }

        var fields = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var name in Patchable)
        {
            if (body.TryGetProperty(name, out var value))
            {
                fields[name] = value;
            }
        }

        return new PatchBcfTopicRequest(version, fields);
    }
}

/// <summary>The result of an import: how many topics were created or updated.</summary>
public sealed record BcfImportResult(int TopicsUpserted);
#pragma warning restore CA1720
