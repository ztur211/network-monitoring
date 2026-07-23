using System.Text.Json;
using NodeScope.Modules.Inventory.Domain.Bcf;

namespace NodeScope.Modules.Inventory.Application.Bcf;

// "Guid" is the BCF 2.1 field name, carried through from the file format to the wire, so the
// members below keep it despite CA1720's general advice about type names in identifiers.
#pragma warning disable CA1720

/// <summary>A topic row plus the relations every read shape needs.</summary>
public sealed record BcfTopicRecord(
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
    DateTime CreatedAt,
    DateTime UpdatedAt,
    IReadOnlyList<BcfCommentRecord> Comments,
    IReadOnlyList<BcfViewpointRecord> Viewpoints,
    IReadOnlyList<string> DeviceIds);

public sealed record BcfCommentRecord(
    string Id,
    string Guid,
    string Comment,
    string Author,
    DateTime Date,
    string? ViewpointGuid);

public sealed record BcfViewpointRecord(
    string Id,
    string Guid,
    BcfCamera Camera,
    BcfComponents Components,
    IReadOnlyList<JsonElement> ClippingPlanes,
    string? SnapshotKey,
    bool IsPrimary);

/// <summary>Everything one topic write needs, so a topic and its children land atomically.</summary>
public sealed record BcfTopicWrite(
    string Guid,
    string Title,
    string? TopicType,
    string? TopicStatus,
    string? Priority,
    IReadOnlyList<string> Labels,
    string CreationAuthor,
    DateTime CreationDate,
    string? AssignedTo,
    DateTime? DueDate,
    string? Description,
    IReadOnlyList<BcfCommentWrite> Comments,
    IReadOnlyList<BcfViewpointWrite> Viewpoints,
    IReadOnlyList<string> DeviceIds);

public sealed record BcfCommentWrite(
    string Guid,
    string Comment,
    string Author,
    DateTime Date,
    string? ViewpointGuid);

public sealed record BcfViewpointWrite(
    string Guid,
    BcfCamera Camera,
    BcfComponents Components,
    IReadOnlyList<JsonElement> ClippingPlanes,
    string? SnapshotKey,
    bool IsPrimary);

/// <summary>BCF persistence (Node's BCF Prisma access, which lived in the services).</summary>
public interface IBcfRepository
{
    /// <summary>A building's topics, newest first, with comments and viewpoints loaded.</summary>
    public Task<IReadOnlyList<BcfTopicRecord>> ListByBuildingAsync(
        string organizationId,
        string propertyId,
        bool oldestFirst,
        CancellationToken cancellationToken);

    public Task<BcfTopicRecord?> FindAsync(string organizationId, string topicId, CancellationToken cancellationToken);

    /// <summary>Creates the topic with its comments, viewpoints, and device links in one transaction.</summary>
    public Task<BcfTopicRecord> CreateAsync(
        string organizationId,
        string propertyId,
        BcfTopicWrite topic,
        CancellationToken cancellationToken);

    /// <summary>
    /// Creates or replaces topics keyed by <c>[organizationId, guid]</c>, so re-importing the
    /// same archive updates in place. Returns how many topics were written.
    /// </summary>
    public Task<int> UpsertManyAsync(
        string organizationId,
        string propertyId,
        IReadOnlyList<BcfTopicWrite> topics,
        CancellationToken cancellationToken);

    /// <summary>Snapshot keys currently referenced by the given topic guids, for reclaiming.</summary>
    public Task<IReadOnlyList<string>> SnapshotKeysForGuidsAsync(
        string organizationId,
        IReadOnlyCollection<string> topicGuids,
        CancellationToken cancellationToken);

    public Task<BcfCommentRecord> AddCommentAsync(
        string organizationId,
        string topicId,
        BcfCommentWrite comment,
        string modifiedAuthor,
        CancellationToken cancellationToken);

    /// <summary>Optimistic metadata patch; false when <paramref name="expectedVersion"/> is stale.</summary>
    public Task<bool> PatchAsync(
        string organizationId,
        string topicId,
        IReadOnlyDictionary<string, JsonElement> fields,
        string modifiedAuthor,
        int expectedVersion,
        CancellationToken cancellationToken);
}
#pragma warning restore CA1720
