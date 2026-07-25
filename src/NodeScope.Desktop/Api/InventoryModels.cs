using System.Text.Json;

namespace NodeScope.Desktop.Api;

/// <summary>The unfiltered <c>GET /api/v1/devices</c> shape: <c>{ items, total }</c>.</summary>
internal sealed record DevicePage(IReadOnlyList<BimDevice> Items, int Total);

/// <summary>
/// Body of <c>POST /api/v1/devices</c>. Unlike the retired web client, the C# host
/// requires <see cref="NetworkId"/> and <see cref="PropertyId"/>: a device only exists
/// on a property chartered to the org's network (<c>PROP_007</c> otherwise).
/// </summary>
internal sealed record CreateDevice(
    string Name,
    string Category,
    string NetworkId,
    string PropertyId,
    double? Latitude,
    double? Longitude,
    int? Floor,
    string? FloorLabel,
    string? IpAddress,
    string? MacAddress,
    string? Notes);

/// <summary>
/// One entry of the optimistic-concurrency PATCH body
/// (<c>{ baseVersion, changes: [{ field, oldValue, newValue }] }</c>) every versioned
/// entity shares. Values ride as raw JSON so a string field can be told from a number
/// and an explicit <c>null</c> (clear) survives serialization.
/// </summary>
internal sealed record FieldChange(string Field, JsonElement OldValue, JsonElement NewValue)
{
    /// <summary>Builds a change from plain values (string, number, or null).</summary>
    public static FieldChange Of(string field, object? oldValue, object? newValue) => new(
        field,
        JsonSerializer.SerializeToElement(oldValue),
        JsonSerializer.SerializeToElement(newValue));
}

/// <summary>A circuit as the client reads it (<c>CircuitDto</c> narrowed not at all - every field shows).</summary>
internal sealed record Circuit(
    string Id,
    string? UserId,
    string IspName,
    string? CircuitId,
    string ServiceType,
    double? Bandwidth,
    string? DeviceId,
    string? Notes,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt);

/// <summary>The cursor-paginated <c>GET /api/v1/circuits</c> shape.</summary>
internal sealed record CircuitPage(IReadOnlyList<Circuit> Items, string? NextCursor, int Total);

/// <summary>Body of <c>POST /api/v1/circuits</c>.</summary>
internal sealed record CreateCircuit(
    string IspName,
    string? CircuitId,
    string ServiceType,
    double? Bandwidth,
    string? DeviceId,
    string? Notes);

/// <summary>The latest browser-collector reading attached to the calling user, if any.</summary>
internal sealed record ClientMetrics(
    double? BandwidthDown,
    double? BandwidthUp,
    double? Latency,
    string? ConnectionQuality,
    DateTime Timestamp);

/// <summary>The calling client as the appliance sees it.</summary>
internal sealed record ClientDevice(string UserAgent, string? Platform, ClientMetrics? Metrics);

/// <summary>The desktop-agent availability notice the Clients tab surfaces.</summary>
internal sealed record ClientAgentStatus(bool Available, string Message);

/// <summary>The <c>GET /api/v1/clients</c> read.</summary>
internal sealed record ClientsSummary(ClientDevice CurrentDevice, ClientAgentStatus AgentStatus);

/// <summary>A network row from <c>GET /api/v1/networks</c> (never carries <c>homePublicIp</c>).</summary>
internal sealed record NetworkSummary(
    string Id,
    string Name,
    string? HomeAddress,
    double? HomeLatitude,
    double? HomeLongitude,
    string? Isp,
    double? DownMbps,
    double? UpMbps,
    int Version);
