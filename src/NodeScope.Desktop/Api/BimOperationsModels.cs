namespace NodeScope.Desktop.Api;

/// <summary>A building-scoped device as needed by spatial operations and the NOC HUD.</summary>
internal sealed record BimDevice(
    string Id,
    string NetworkId,
    string PropertyId,
    string? RoleCode,
    string? UserId,
    string Name,
    string Category,
    double? Latitude,
    double? Longitude,
    int? Floor,
    string? FloorLabel,
    double? X,
    double? Y,
    double? Z,
    string? IfcGlobalId,
    string? IpAddress,
    string? MacAddress,
    string? Notes,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt)
{
    public bool IsPlaced => X is not null && Y is not null && Z is not null;
}

internal sealed record AccessSummary(
    string Role,
    IReadOnlyList<string> AssignedRootPropertyIds,
    bool Unscoped)
{
    public bool CanConfigure =>
        string.Equals(Role, "OWNER", StringComparison.Ordinal)
        || string.Equals(Role, "ADMIN", StringComparison.Ordinal);
}

internal sealed record BimDeviceStatus(
    string DeviceId,
    string State,
    double? LatencyMs,
    DateTime? LastCheckAt,
    DateTime? LastOkAt,
    DateTime? LastChangeAt);

internal sealed record BimMetricPoint(DateTime Bucket, double Avg);

internal sealed record BimStatusEvent(DateTime Time, string State, string? Source);

internal sealed record BcfTopicSummary(
    string Id,
    string PropertyId,
    string Guid,
    string Title,
    string? TopicType,
    string? TopicStatus,
    string? Priority,
    int Version,
    int CommentCount);

internal sealed record BcfTopic(
    string Id,
    string PropertyId,
    string Guid,
    string Title,
    string? TopicType,
    string? TopicStatus,
    string? Priority,
    int Version,
    int CommentCount,
    IReadOnlyList<BcfComment> Comments,
    IReadOnlyList<BcfViewpoint> Viewpoints);

internal sealed record BcfComment(
    string Id,
    string Guid,
    string Comment,
    string Author,
    DateTime Date,
    string? ViewpointGuid);

internal sealed record BcfViewpoint(
    string Id,
    string Guid,
    BcfCamera Camera,
    BcfComponents Components,
    IReadOnlyList<object> ClippingPlanes,
    bool IsPrimary,
    bool HasSnapshot);

internal sealed record BcfCamera(
    string Kind,
    IReadOnlyList<double> Position,
    IReadOnlyList<double> Direction,
    IReadOnlyList<double> Up,
    double? FieldOfView,
    double? ViewToWorldScale);

internal sealed record BcfComponents(
    IReadOnlyList<string> Selection,
    BcfVisibility Visibility);

internal sealed record BcfVisibility(
    bool DefaultVisibility,
    IReadOnlyList<string> Exceptions);

internal sealed record CreateBcfTopic(
    string Title,
    string? TopicType,
    string? TopicStatus,
    string? Priority,
    IReadOnlyList<string> Labels,
    string? AssignedTo,
    DateTime? DueDate,
    string? Description,
    IReadOnlyList<CreateBcfViewpoint> Viewpoints);

internal sealed record CreateBcfViewpoint(
    string? Guid,
    BcfCamera Camera,
    BcfComponents Components,
    bool IsPrimary,
    string? SnapshotPngBase64);
