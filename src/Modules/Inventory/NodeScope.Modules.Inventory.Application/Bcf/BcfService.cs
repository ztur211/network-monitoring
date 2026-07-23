using System.Text.Json;
using NodeScope.Contracts.Realtime;
using NodeScope.Modules.Inventory.Application.Devices;
using NodeScope.Modules.Inventory.Application.Properties;
using NodeScope.Modules.Inventory.Domain.Bcf;
using NodeScope.Modules.Inventory.Domain.Ifc;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Bcf;

/// <summary>
/// BCF topic and comment CRUD (Node's <c>BcfService</c>). Reads are open to in-scope members
/// and 404 outside scope; mutations need OWNER/ADMIN-in-scope. Patches are optimistic:
/// a stale <c>baseVersion</c> is <c>BCF_005</c>.
/// </summary>
public sealed class BcfService
{
    private readonly IBcfRepository _bcf;
    private readonly BcfAccess _access;
    private readonly BcfDeviceLinks _deviceLinks;
    private readonly IObjectStorage _storage;
    private readonly IPermissionScopeService _permissions;
    private readonly IRealtimeService _realtime;

    public BcfService(
        IBcfRepository bcf,
        BcfAccess access,
        BcfDeviceLinks deviceLinks,
        IObjectStorage storage,
        IPermissionScopeService permissions,
        IRealtimeService realtime)
    {
        _bcf = bcf;
        _access = access;
        _deviceLinks = deviceLinks;
        _storage = storage;
        _permissions = permissions;
        _realtime = realtime;
    }

    public async Task<IReadOnlyList<BcfTopicSummaryDto>> ListTopicsAsync(
        OrgMemberContext member,
        string buildingPropertyId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        await _access.AssertViewAsync(member, buildingPropertyId, cancellationToken);
        var topics = await _bcf.ListByBuildingAsync(
            member.OrganizationId, buildingPropertyId, oldestFirst: false, cancellationToken);
        return [.. topics.Select(BcfMapper.ToSummary)];
    }

    public async Task<BcfTopicDto> GetTopicAsync(
        OrgMemberContext member,
        string topicId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var topic = await RequireTopicAsync(member, topicId, cancellationToken);
        await _access.AssertViewAsync(member, topic.PropertyId, cancellationToken);
        return BcfMapper.ToTopic(topic);
    }

    public async Task<BcfTopicDto> CreateTopicAsync(
        OrgMemberContext member,
        string buildingPropertyId,
        CreateBcfTopicRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(request);

        // The building must exist before the permission gate, so a bad id reads as PROP_001
        // rather than leaking whether the caller would have been allowed.
        await _access.AssertBuildingExistsAsync(member.OrganizationId, buildingPropertyId, cancellationToken);
        await _permissions.AssertCanConfigureAsync(member, buildingPropertyId, cancellationToken);

        var topicGuid = Guid.NewGuid().ToString();
        var deviceGuidMap = await _deviceLinks.BuildAsync(
            member.OrganizationId, buildingPropertyId, cancellationToken);

        var uploaded = new List<string>();
        var viewpoints = new List<BcfViewpointWrite>();
        var selections = new List<string>();
        try
        {
            var index = 0;
            foreach (var viewpoint in request.Viewpoints ?? [])
            {
                var guid = viewpoint.Guid ?? Guid.NewGuid().ToString();
                string? snapshotKey = null;
                if (viewpoint.SnapshotPngBase64 is not null)
                {
                    var png = DecodePng(viewpoint.SnapshotPngBase64);
                    snapshotKey = StorageKeys.BcfSnapshot(member.OrganizationId, topicGuid, guid);
                    uploaded.Add(snapshotKey);
                    using var content = new MemoryStream(png);
                    await _storage.PutAsync(snapshotKey, content, "image/png", cancellationToken);
                }

                var components = viewpoint.Components ?? new BcfComponents([], new BcfVisibility(true, []));
                selections.AddRange(components.Selection);
                viewpoints.Add(new BcfViewpointWrite(
                    guid,
                    viewpoint.Camera ?? EmptyCamera,
                    components,
                    [],
                    snapshotKey,
                    viewpoint.IsPrimary ?? index == 0));
                index++;
            }

            var now = DateTime.UtcNow;
            var created = await _bcf.CreateAsync(
                member.OrganizationId,
                buildingPropertyId,
                new BcfTopicWrite(
                    topicGuid,
                    request.Title ?? "",
                    request.TopicType,
                    request.TopicStatus,
                    request.Priority,
                    request.Labels ?? [],
                    member.MemberId,
                    now,
                    request.AssignedTo,
                    request.DueDate,
                    request.Description,
                    [],
                    viewpoints,
                    BcfDeviceLinks.Resolve(selections, deviceGuidMap)),
                cancellationToken);

            var dto = BcfMapper.ToTopic(created);
            await _realtime.EmitScopedAsync(
                member.OrganizationId,
                buildingPropertyId,
                WsEvents.BcfTopicCreated,
                new { topic = dto, timestamp = IsoTimestamp.Now() },
                cancellationToken);
            return dto;
        }
        catch (Exception)
        {
            await BcfSnapshots.DeleteAllAsync(_storage, uploaded, cancellationToken);
            throw;
        }
    }

    public async Task<BcfTopicDto> AddCommentAsync(
        OrgMemberContext member,
        string topicId,
        AddBcfCommentRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(request);
        var topic = await RequireTopicAsync(member, topicId, cancellationToken);
        await _permissions.AssertCanConfigureAsync(member, topic.PropertyId, cancellationToken);

        var comment = await _bcf.AddCommentAsync(
            member.OrganizationId,
            topic.Id,
            new BcfCommentWrite(
                Guid.NewGuid().ToString(),
                request.Comment ?? "",
                member.MemberId,
                DateTime.UtcNow,
                request.ViewpointGuid),
            member.MemberId,
            cancellationToken);

        var updated = await RequireTopicAsync(member, topicId, cancellationToken);
        await _realtime.EmitScopedAsync(
            member.OrganizationId,
            topic.PropertyId,
            WsEvents.BcfCommentAdded,
            new { topicId, comment = BcfMapper.ToComment(comment), timestamp = IsoTimestamp.Now() },
            cancellationToken);
        return BcfMapper.ToTopic(updated);
    }

    public async Task<BcfTopicDto> PatchTopicAsync(
        OrgMemberContext member,
        string topicId,
        PatchBcfTopicRequest patch,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(patch);
        var topic = await RequireTopicAsync(member, topicId, cancellationToken);
        await _permissions.AssertCanConfigureAsync(member, topic.PropertyId, cancellationToken);

        if (!await _bcf.PatchAsync(
            member.OrganizationId, topic.Id, patch.Fields, member.MemberId, patch.BaseVersion, cancellationToken))
        {
            throw InventoryErrors.BcfTopicConflict();
        }

        var updated = await RequireTopicAsync(member, topicId, cancellationToken);
        var dto = BcfMapper.ToTopic(updated);
        await _realtime.EmitScopedAsync(
            member.OrganizationId,
            topic.PropertyId,
            WsEvents.BcfTopicUpdated,
            new { topic = dto, timestamp = IsoTimestamp.Now() },
            cancellationToken);
        return dto;
    }

    private static readonly BcfCamera EmptyCamera =
        new("perspective", [0, 0, 0], [0, 0, -1], [0, 1, 0], null, null);

    private static byte[] DecodePng(string base64)
    {
        byte[] png;
        try
        {
            png = Convert.FromBase64String(base64);
        }
        catch (FormatException)
        {
            throw InventoryErrors.InvalidSnapshot();
        }

        return BcfArchive.IsPng(png) ? png : throw InventoryErrors.InvalidSnapshot();
    }

    private async Task<BcfTopicRecord> RequireTopicAsync(
        OrgMemberContext member,
        string topicId,
        CancellationToken cancellationToken) =>
        await _bcf.FindAsync(member.OrganizationId, topicId, cancellationToken)
        ?? throw InventoryErrors.BcfTopicNotFound();
}

/// <summary>Row-to-DTO mapping for the BCF read shapes.</summary>
internal static class BcfMapper
{
    public static BcfTopicSummaryDto ToSummary(BcfTopicRecord topic) => new(
        topic.Id, topic.OrganizationId, topic.PropertyId, topic.Guid, topic.Title, topic.TopicType,
        topic.TopicStatus, topic.Priority, topic.Labels, topic.CreationAuthor, topic.CreationDate,
        topic.ModifiedAuthor, topic.ModifiedDate, topic.AssignedTo, topic.DueDate, topic.Description,
        topic.Version, topic.Comments.Count, topic.DeviceIds, topic.CreatedAt, topic.UpdatedAt);

    public static BcfTopicDto ToTopic(BcfTopicRecord topic) => new(
        topic.Id, topic.OrganizationId, topic.PropertyId, topic.Guid, topic.Title, topic.TopicType,
        topic.TopicStatus, topic.Priority, topic.Labels, topic.CreationAuthor, topic.CreationDate,
        topic.ModifiedAuthor, topic.ModifiedDate, topic.AssignedTo, topic.DueDate, topic.Description,
        topic.Version, topic.Comments.Count, topic.DeviceIds, topic.CreatedAt, topic.UpdatedAt,
        [.. topic.Comments.Select(ToComment)],
        [.. topic.Viewpoints.Select(ToViewpoint)]);

    public static BcfCommentDto ToComment(BcfCommentRecord comment) => new(
        comment.Id, comment.Guid, comment.Comment, comment.Author, comment.Date, comment.ViewpointGuid);

    private static BcfViewpointDto ToViewpoint(BcfViewpointRecord viewpoint) => new(
        viewpoint.Id,
        viewpoint.Guid,
        viewpoint.Camera,
        viewpoint.Components,
        [.. viewpoint.ClippingPlanes.Cast<object>()],
        viewpoint.IsPrimary,
        viewpoint.SnapshotKey is not null);
}

/// <summary>The building-existence and F3 read gates both BCF services apply.</summary>
public sealed class BcfAccess
{
    private readonly IPropertyRepository _properties;
    private readonly IPermissionScopeService _permissions;

    public BcfAccess(IPropertyRepository properties, IPermissionScopeService permissions)
    {
        _properties = properties;
        _permissions = permissions;
    }

    public async Task AssertBuildingExistsAsync(
        string organizationId,
        string buildingPropertyId,
        CancellationToken cancellationToken)
    {
        if (await _properties.FindAsync(organizationId, buildingPropertyId, null, cancellationToken) is null)
        {
            throw InventoryErrors.PropertyNotFound();
        }
    }

    /// <summary>Out of scope reads as "no such building" rather than as a refusal.</summary>
    public async Task AssertViewAsync(
        OrgMemberContext member,
        string buildingPropertyId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        await AssertBuildingExistsAsync(member.OrganizationId, buildingPropertyId, cancellationToken);
        if (!await _permissions.IsInScopeAsync(member, buildingPropertyId, cancellationToken))
        {
            throw InventoryErrors.PropertyNotFound();
        }
    }
}

/// <summary>
/// Resolves BCF viewpoint components to NodeScope devices. The join key is
/// <c>IfcGuid.Of(deviceId)</c>: the exported model carries that id on each element, so a
/// coordination tool's selection comes back as an id we can map to a device.
/// </summary>
public sealed class BcfDeviceLinks
{
    private readonly IPropertyRepository _properties;
    private readonly IDeviceRepository _devices;

    public BcfDeviceLinks(IPropertyRepository properties, IDeviceRepository devices)
    {
        _properties = properties;
        _devices = devices;
    }

    public async Task<IReadOnlyDictionary<string, string>> BuildAsync(
        string organizationId,
        string buildingPropertyId,
        CancellationToken cancellationToken)
    {
        var subtree = await _properties.SubtreeIdsAsync(organizationId, buildingPropertyId, cancellationToken);
        if (subtree.Count == 0)
        {
            return new Dictionary<string, string>(StringComparer.Ordinal);
        }

        var devices = await _devices.ListAsync(organizationId, subtree, cancellationToken);
        return devices.ToDictionary(device => IfcGuid.Of(device.Id), device => device.Id, StringComparer.Ordinal);
    }

    /// <summary>The distinct device ids the given component ids resolve to.</summary>
    public static IReadOnlyList<string> Resolve(
        IEnumerable<string> ifcGuids,
        IReadOnlyDictionary<string, string> deviceGuidMap)
    {
        ArgumentNullException.ThrowIfNull(ifcGuids);
        ArgumentNullException.ThrowIfNull(deviceGuidMap);
        var deviceIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var ifcGuid in ifcGuids)
        {
            if (deviceGuidMap.TryGetValue(ifcGuid, out var deviceId))
            {
                deviceIds.Add(deviceId);
            }
        }

        return [.. deviceIds];
    }
}

/// <summary>Snapshot cleanup shared by create and import.</summary>
internal static class BcfSnapshots
{
    /// <summary>
    /// Best-effort: every key is attempted and failures are swallowed, because this runs while
    /// another exception is in flight and a storage error must not replace the real cause.
    /// </summary>
    public static async Task DeleteAllAsync(
        IObjectStorage storage,
        IEnumerable<string> keys,
        CancellationToken cancellationToken)
    {
        foreach (var key in keys.Distinct(StringComparer.Ordinal))
        {
#pragma warning disable CA1031
            try
            {
                await storage.DeleteAsync(key, cancellationToken);
            }
            catch (Exception)
            {
            }
#pragma warning restore CA1031
        }
    }
}
