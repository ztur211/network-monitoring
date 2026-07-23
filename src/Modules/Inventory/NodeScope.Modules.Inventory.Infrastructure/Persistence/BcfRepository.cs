using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Inventory.Application.Bcf;
using NodeScope.Modules.Inventory.Domain.Bcf;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Infrastructure.Persistence;

internal sealed class BcfRepository : IBcfRepository
{
    private readonly InventoryDbContext _db;

    public BcfRepository(InventoryDbContext db)
    {
        _db = db;
    }

    public async Task<IReadOnlyList<BcfTopicRecord>> ListByBuildingAsync(
        string organizationId,
        string propertyId,
        bool oldestFirst,
        CancellationToken cancellationToken)
    {
        var query = _db.BcfTopics.Where(t => t.OrganizationId == organizationId && t.PropertyId == propertyId);
        query = oldestFirst ? query.OrderBy(t => t.CreatedAt) : query.OrderByDescending(t => t.CreatedAt);
        var topics = await query.AsNoTracking().ToListAsync(cancellationToken);
        return await LoadRelationsAsync([.. topics], cancellationToken);
    }

    public async Task<BcfTopicRecord?> FindAsync(
        string organizationId,
        string topicId,
        CancellationToken cancellationToken)
    {
        var topic = await _db.BcfTopics
            .AsNoTracking()
            .SingleOrDefaultAsync(t => t.Id == topicId && t.OrganizationId == organizationId, cancellationToken);
        if (topic is null)
        {
            return null;
        }

        var loaded = await LoadRelationsAsync([topic], cancellationToken);
        return loaded[0];
    }

    public async Task<BcfTopicRecord> CreateAsync(
        string organizationId,
        string propertyId,
        BcfTopicWrite topic,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(topic);
        var row = NewTopicRow(organizationId, propertyId, topic);
        _db.BcfTopics.Add(row);
        AddChildren(organizationId, row.Id, topic);
        await _db.SaveChangesAsync(cancellationToken);
        return (await LoadRelationsAsync([row], cancellationToken))[0];
    }

    public async Task<int> UpsertManyAsync(
        string organizationId,
        string propertyId,
        IReadOnlyList<BcfTopicWrite> topics,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(topics);
        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);

        foreach (var topic in topics)
        {
            var existing = await _db.BcfTopics.SingleOrDefaultAsync(
                t => t.OrganizationId == organizationId && t.Guid == topic.Guid, cancellationToken);
            if (existing is null)
            {
                var row = NewTopicRow(organizationId, propertyId, topic);
                _db.BcfTopics.Add(row);
                AddChildren(organizationId, row.Id, topic);
                continue;
            }

            existing.Title = topic.Title;
            existing.TopicType = topic.TopicType;
            existing.TopicStatus = topic.TopicStatus;
            existing.Priority = topic.Priority;
            existing.Labels = [.. topic.Labels];
            existing.AssignedTo = topic.AssignedTo;
            existing.Description = topic.Description;
            existing.ModifiedDate = DateTime.UtcNow;
            existing.UpdatedAt = DateTime.UtcNow;

            // Children are replaced wholesale: an archive is the authority on its own topic, and
            // deleting unconditionally is what clears links whose devices no longer match.
            await DeleteChildrenAsync(existing.Id, cancellationToken);
            AddChildren(organizationId, existing.Id, topic);
        }

        await _db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return topics.Count;
    }

    public async Task<IReadOnlyList<string>> SnapshotKeysForGuidsAsync(
        string organizationId,
        IReadOnlyCollection<string> topicGuids,
        CancellationToken cancellationToken)
    {
        if (topicGuids.Count == 0)
        {
            return [];
        }

        return await _db.BcfViewpoints
            .Where(v => v.OrganizationId == organizationId
                && v.SnapshotKey != null
                && _db.BcfTopics.Any(t => t.Id == v.TopicId && topicGuids.Contains(t.Guid)))
            .Select(v => v.SnapshotKey!)
            .ToListAsync(cancellationToken);
    }

    public async Task<BcfCommentRecord> AddCommentAsync(
        string organizationId,
        string topicId,
        BcfCommentWrite comment,
        string modifiedAuthor,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(comment);
        var row = new BcfCommentRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = organizationId,
            TopicId = topicId,
            Guid = comment.Guid,
            Comment = comment.Comment,
            Author = comment.Author,
            Date = comment.Date,
            ViewpointGuid = comment.ViewpointGuid,
        };
        _db.BcfComments.Add(row);
        await _db.SaveChangesAsync(cancellationToken);

        await _db.BcfTopics
            .Where(t => t.Id == topicId && t.OrganizationId == organizationId)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(t => t.ModifiedAuthor, modifiedAuthor)
                    .SetProperty(t => t.ModifiedDate, comment.Date)
                    .SetProperty(t => t.Version, t => t.Version + 1)
                    .SetProperty(t => t.UpdatedAt, DateTime.UtcNow),
                cancellationToken);
        return ToRecord(row);
    }

    public async Task<bool> PatchAsync(
        string organizationId,
        string topicId,
        IReadOnlyDictionary<string, JsonElement> fields,
        string modifiedAuthor,
        int expectedVersion,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(fields);
        return await _db.BcfTopics
            .Where(t => t.Id == topicId && t.OrganizationId == organizationId && t.Version == expectedVersion)
            .ExecuteUpdateAsync(
                setters =>
                {
                    setters.SetProperty(t => t.ModifiedAuthor, modifiedAuthor);
                    setters.SetProperty(t => t.ModifiedDate, DateTime.UtcNow);
                    setters.SetProperty(t => t.Version, t => t.Version + 1);
                    setters.SetProperty(t => t.UpdatedAt, DateTime.UtcNow);
                    foreach (var (field, value) in fields)
                    {
                        switch (field)
                        {
                            case "title":
                                setters.SetProperty(t => t.Title, ChangesetValues.AsString(value)!);
                                break;
                            case "topicType":
                                setters.SetProperty(t => t.TopicType, ChangesetValues.AsString(value));
                                break;
                            case "topicStatus":
                                setters.SetProperty(t => t.TopicStatus, ChangesetValues.AsString(value));
                                break;
                            case "priority":
                                setters.SetProperty(t => t.Priority, ChangesetValues.AsString(value));
                                break;
                            case "labels":
                                setters.SetProperty(t => t.Labels, ReadLabels(value));
                                break;
                            case "assignedTo":
                                setters.SetProperty(t => t.AssignedTo, ChangesetValues.AsString(value));
                                break;
                            case "dueDate":
                                setters.SetProperty(t => t.DueDate, ReadDate(value));
                                break;
                            case "description":
                                setters.SetProperty(t => t.Description, ChangesetValues.AsString(value));
                                break;
                            default:
                                throw new ArgumentOutOfRangeException(nameof(fields), field, "not a patchable topic field");
                        }
                    }
                },
                cancellationToken) > 0;
    }

    private static BcfTopicRow NewTopicRow(string organizationId, string propertyId, BcfTopicWrite topic)
    {
        var now = DateTime.UtcNow;
        return new BcfTopicRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = organizationId,
            PropertyId = propertyId,
            Guid = topic.Guid,
            Title = topic.Title,
            TopicType = topic.TopicType,
            TopicStatus = topic.TopicStatus,
            Priority = topic.Priority,
            Labels = [.. topic.Labels],
            CreationAuthor = topic.CreationAuthor,
            CreationDate = topic.CreationDate,
            AssignedTo = topic.AssignedTo,
            DueDate = topic.DueDate,
            Description = topic.Description,
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
    }

    private void AddChildren(string organizationId, string topicId, BcfTopicWrite topic)
    {
        foreach (var comment in topic.Comments)
        {
            _db.BcfComments.Add(new BcfCommentRow
            {
                Id = Guid.NewGuid().ToString(),
                OrganizationId = organizationId,
                TopicId = topicId,
                Guid = comment.Guid,
                Comment = comment.Comment,
                Author = comment.Author,
                Date = comment.Date,
                ViewpointGuid = comment.ViewpointGuid,
            });
        }

        foreach (var viewpoint in topic.Viewpoints)
        {
            _db.BcfViewpoints.Add(new BcfViewpointRow
            {
                Id = Guid.NewGuid().ToString(),
                OrganizationId = organizationId,
                TopicId = topicId,
                Guid = viewpoint.Guid,
                Camera = JsonSerializer.SerializeToDocument(viewpoint.Camera),
                Components = JsonSerializer.SerializeToDocument(viewpoint.Components),
                ClippingPlanes = JsonSerializer.SerializeToDocument(viewpoint.ClippingPlanes),
                SnapshotKey = viewpoint.SnapshotKey,
                IsPrimary = viewpoint.IsPrimary,
            });
        }

        foreach (var deviceId in topic.DeviceIds)
        {
            _db.BcfTopicDevices.Add(new BcfTopicDeviceRow
            {
                Id = Guid.NewGuid().ToString(),
                TopicId = topicId,
                DeviceId = deviceId,
            });
        }
    }

    private async Task DeleteChildrenAsync(string topicId, CancellationToken cancellationToken)
    {
        await _db.BcfComments.Where(c => c.TopicId == topicId).ExecuteDeleteAsync(cancellationToken);
        await _db.BcfViewpoints.Where(v => v.TopicId == topicId).ExecuteDeleteAsync(cancellationToken);
        await _db.BcfTopicDevices.Where(d => d.TopicId == topicId).ExecuteDeleteAsync(cancellationToken);
    }

    private async Task<IReadOnlyList<BcfTopicRecord>> LoadRelationsAsync(
        IReadOnlyList<BcfTopicRow> topics,
        CancellationToken cancellationToken)
    {
        if (topics.Count == 0)
        {
            return [];
        }

        var ids = topics.Select(topic => topic.Id).ToList();
        var comments = await _db.BcfComments
            .Where(c => ids.Contains(c.TopicId))
            .OrderBy(c => c.Date)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
        var viewpoints = await _db.BcfViewpoints
            .Where(v => ids.Contains(v.TopicId))
            .AsNoTracking()
            .ToListAsync(cancellationToken);
        var deviceLinks = await _db.BcfTopicDevices
            .Where(d => ids.Contains(d.TopicId))
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        return
        [
            .. topics.Select(topic => new BcfTopicRecord(
                topic.Id,
                topic.OrganizationId,
                topic.PropertyId,
                topic.Guid,
                topic.Title,
                topic.TopicType,
                topic.TopicStatus,
                topic.Priority,
                topic.Labels,
                topic.CreationAuthor,
                topic.CreationDate,
                topic.ModifiedAuthor,
                topic.ModifiedDate,
                topic.AssignedTo,
                topic.DueDate,
                topic.Description,
                topic.Version,
                topic.CreatedAt,
                topic.UpdatedAt,
                [.. comments.Where(c => c.TopicId == topic.Id).Select(ToRecord)],
                [.. viewpoints.Where(v => v.TopicId == topic.Id).Select(ToRecord)],
                [.. deviceLinks.Where(d => d.TopicId == topic.Id).Select(d => d.DeviceId)])),
        ];
    }

    private static BcfCommentRecord ToRecord(BcfCommentRow row) => new(
        row.Id, row.Guid, row.Comment, row.Author, row.Date, row.ViewpointGuid);

    private static BcfViewpointRecord ToRecord(BcfViewpointRow row) => new(
        row.Id,
        row.Guid,
        row.Camera.Deserialize<BcfCamera>()!,
        row.Components.Deserialize<BcfComponents>()!,
        row.ClippingPlanes.RootElement.ValueKind == JsonValueKind.Array
            ? [.. row.ClippingPlanes.RootElement.EnumerateArray()]
            : [],
        row.SnapshotKey,
        row.IsPrimary);

    private static string[] ReadLabels(JsonElement value) =>
        value.ValueKind == JsonValueKind.Array
            ? [.. value.EnumerateArray().Select(label => label.GetString() ?? "")]
            : [];

    private static DateTime? ReadDate(JsonElement value) =>
        ChangesetValues.IsNullish(value) ? null : value.GetDateTime();
}
