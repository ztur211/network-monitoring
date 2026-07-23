using NodeScope.Modules.Inventory.Domain.Bcf;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Bcf;

/// <summary>
/// BCF archive import and export (Node's <c>BcfImportService</c> + <c>BcfExportService</c>).
/// Import upserts by <c>[organizationId, guid]</c>, so re-importing an archive updates the
/// same topics instead of duplicating them.
/// </summary>
public sealed class BcfArchiveService
{
    /// <summary>50 MB compressed, the cap the Node import enforced before parsing.</summary>
    public const long MaxArchiveBytes = 50 * 1024 * 1024;

    private readonly IBcfRepository _bcf;
    private readonly BcfAccess _access;
    private readonly BcfDeviceLinks _deviceLinks;
    private readonly IObjectStorage _storage;
    private readonly IPermissionScopeService _permissions;

    public BcfArchiveService(
        IBcfRepository bcf,
        BcfAccess access,
        BcfDeviceLinks deviceLinks,
        IObjectStorage storage,
        IPermissionScopeService permissions)
    {
        _bcf = bcf;
        _access = access;
        _deviceLinks = deviceLinks;
        _storage = storage;
        _permissions = permissions;
    }

    public async Task<BcfImportResult> ImportAsync(
        OrgMemberContext member,
        string buildingPropertyId,
        ReadOnlyMemory<byte> archive,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        if (archive.Length > MaxArchiveBytes)
        {
            throw BcfArchive.TooLarge();
        }

        await _access.AssertBuildingExistsAsync(member.OrganizationId, buildingPropertyId, cancellationToken);
        await _permissions.AssertCanConfigureAsync(member, buildingPropertyId, cancellationToken);

        IReadOnlyList<BcfTopicData> parsed;
        try
        {
            parsed = BcfArchive.Read(archive, BcfArchive.DefaultMaxDecompressedBytes);
        }
        catch (ApiException)
        {
            // BCF_001 (a zip bomb) and BCF_003 (malformed) both surface from the codec already
            // carrying the right code.
            throw;
        }
        catch (InvalidDataException)
        {
            throw BcfArchive.Malformed();
        }

        var deviceGuidMap = await _deviceLinks.BuildAsync(
            member.OrganizationId, buildingPropertyId, cancellationToken);

        // Keys still referenced by the topics about to be replaced; reclaimed once the write
        // succeeds, since nothing can reach them afterwards.
        var supersededKeys = await _bcf.SnapshotKeysForGuidsAsync(
            member.OrganizationId, [.. parsed.Select(topic => topic.Guid)], cancellationToken);

        var uploaded = new List<string>();
        int upserted;
        try
        {
            var topics = new List<BcfTopicWrite>(parsed.Count);
            foreach (var topic in parsed)
            {
                var viewpoints = new List<BcfViewpointWrite>(topic.Viewpoints.Count);
                foreach (var viewpoint in topic.Viewpoints)
                {
                    string? snapshotKey = null;
                    if (viewpoint.IsPrimary)
                    {
                        if (viewpoint.SnapshotPng is not { } png || !BcfArchive.IsPng(png.Span))
                        {
                            throw InventoryErrors.MissingSnapshotPng();
                        }

                        snapshotKey = StorageKeys.BcfSnapshot(
                            member.OrganizationId, topic.Guid, viewpoint.Guid);
                        uploaded.Add(snapshotKey);
                        using var content = new MemoryStream(png.ToArray());
                        await _storage.PutAsync(snapshotKey, content, "image/png", cancellationToken);
                    }

                    viewpoints.Add(new BcfViewpointWrite(
                        viewpoint.Guid, viewpoint.Camera, viewpoint.Components, [], snapshotKey, viewpoint.IsPrimary));
                }

                var selections = topic.Viewpoints.SelectMany(viewpoint => viewpoint.Components.Selection);
                topics.Add(new BcfTopicWrite(
                    topic.Guid,
                    topic.Title,
                    topic.TopicType,
                    topic.TopicStatus,
                    topic.Priority,
                    topic.Labels,
                    topic.CreationAuthor,
                    topic.CreationDate,
                    topic.AssignedTo,
                    DueDate: null,
                    topic.Description,
                    [.. topic.Comments.Select(comment => new BcfCommentWrite(
                        comment.Guid, comment.Comment, comment.Author, comment.Date, comment.ViewpointGuid))],
                    viewpoints,
                    BcfDeviceLinks.Resolve(selections, deviceGuidMap)));
            }

            upserted = await _bcf.UpsertManyAsync(
                member.OrganizationId, buildingPropertyId, topics, cancellationToken);
        }
        catch (Exception)
        {
            await BcfSnapshots.DeleteAllAsync(_storage, uploaded, cancellationToken);
            throw;
        }

        await BcfSnapshots.DeleteAllAsync(_storage, supersededKeys, cancellationToken);
        return new BcfImportResult(upserted);
    }

    public async Task<byte[]> ExportAsync(
        OrgMemberContext member,
        string buildingPropertyId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        await _access.AssertViewAsync(member, buildingPropertyId, cancellationToken);
        var topics = await _bcf.ListByBuildingAsync(
            member.OrganizationId, buildingPropertyId, oldestFirst: true, cancellationToken);

        var snapshots = await LoadSnapshotsAsync(topics, cancellationToken);
        var archive = new List<BcfTopicData>(topics.Count);
        foreach (var topic in topics)
        {
            var viewpoints = topic.Viewpoints
                // The codec writes viewpoints[0], so the primary has to come first.
                .OrderByDescending(viewpoint => viewpoint.IsPrimary)
                .Select(viewpoint => new BcfViewpointData(
                    viewpoint.Guid,
                    viewpoint.IsPrimary,
                    viewpoint.Camera,
                    viewpoint.Components,
                    viewpoint.SnapshotKey is not null && snapshots.TryGetValue(viewpoint.SnapshotKey, out var png)
                        ? png
                        : null))
                .ToList();

            archive.Add(new BcfTopicData(
                topic.Guid,
                topic.Title,
                topic.TopicType,
                topic.TopicStatus,
                topic.Priority,
                topic.Labels,
                topic.CreationAuthor,
                topic.CreationDate,
                topic.AssignedTo,
                topic.Description,
                [.. topic.Comments.Select(comment => new BcfCommentData(
                    comment.Guid, comment.Comment, comment.Author, comment.Date, comment.ViewpointGuid))],
                viewpoints));
        }

        return BcfArchive.Write(archive);
    }

    private async Task<Dictionary<string, ReadOnlyMemory<byte>>> LoadSnapshotsAsync(
        IReadOnlyList<BcfTopicRecord> topics,
        CancellationToken cancellationToken)
    {
        var keys = topics
            .SelectMany(topic => topic.Viewpoints)
            .Select(viewpoint => viewpoint.SnapshotKey)
            .OfType<string>()
            .Distinct(StringComparer.Ordinal);

        var snapshots = new Dictionary<string, ReadOnlyMemory<byte>>(StringComparer.Ordinal);
        foreach (var key in keys)
        {
            await using var content = await _storage.GetAsync(key, cancellationToken);
            using var buffer = new MemoryStream();
            await content.CopyToAsync(buffer, cancellationToken);
            snapshots[key] = buffer.ToArray();
        }

        return snapshots;
    }
}
