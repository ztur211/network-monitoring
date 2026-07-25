using System.Globalization;

namespace NodeScope.Desktop.Api;

/// <summary>
/// The slice of a device the map renders - a client-local read model of
/// <c>GET /api/v1/map/devices</c> and <c>GET /api/v1/devices</c> items.
/// </summary>
internal sealed record MapDevice(
    string Id,
    string Name,
    string Category,
    double? Latitude,
    double? Longitude,
    int? Floor,
    string? FloorLabel,
    string? IpAddress,
    string? PropertyId = null);

/// <summary>
/// A fiber run as the map needs it: the line geometry is DERIVED by joining
/// <see cref="StartDeviceId"/>/<see cref="EndDeviceId"/> to device coordinates -
/// runs carry no geometry of their own on the wire.
/// </summary>
internal sealed record MapFiberRun(
    string Id,
    string Name,
    string StartDeviceId,
    string EndDeviceId);

/// <summary>A WGS84 bounding box, serialized as the API's <c>west,south,east,north</c> query value.</summary>
internal readonly record struct MapBbox(double West, double South, double East, double North)
{
    public override string ToString() => string.Create(
        CultureInfo.InvariantCulture, $"{West},{South},{East},{North}");
}
