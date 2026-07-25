namespace NodeScope.Desktop.Map;

/// <summary>
/// Presentation config for one device category on the map. <c>MinZoom</c> is the gate:
/// the category's markers appear at that zoom and closer.
/// </summary>
internal sealed record DeviceCategoryInfo(
    string Category, string DisplayName, string Abbreviation, string Color, int MinZoom, string Group);

/// <summary>
/// The category palette, abbreviations, and zoom gates - a 1:1 port of the web
/// client's DEVICE_CATEGORY_CONFIG + DeviceMarker constants so the native map
/// draws exactly what the web map drew. Colors are deliberately non-status
/// (no green/amber/red): status will arrive as a separate visual channel.
/// </summary>
internal static class DeviceCategories
{
    /// <summary>Zoom gates: 10 ISP, 13 core, 16 network equipment, 18 end-user.</summary>
    public static IReadOnlyList<DeviceCategoryInfo> All { get; } =
    [
        new("RAD", "RAD", "RAD", "#1d4ed8", 10, "ISP Equipment"),
        new("ONT", "ONT", "ONT", "#1d4ed8", 10, "ISP Equipment"),
        new("DSLAM", "DSLAM", "DSL", "#1d4ed8", 10, "ISP Equipment"),
        new("ROUTER", "Router", "RT", "#4f46e5", 13, "Core Infrastructure"),
        new("MODEM", "Modem", "MDM", "#4f46e5", 13, "Core Infrastructure"),
        new("FIBER_MEDIA_CONVERTER", "Fiber Converter", "FMC", "#4f46e5", 13, "Core Infrastructure"),
        new("FIREWALL", "Firewall", "FW", "#1f2937", 13, "Core Infrastructure"),
        new("SWITCH", "Switch", "SW", "#0d9488", 16, "Network Equipment"),
        new("ACCESS_POINT", "Access Point", "AP", "#0d9488", 16, "Network Equipment"),
        new("WIFI_EXTENDER", "Wi-Fi Extender", "WE", "#0d9488", 16, "Network Equipment"),
        new("WIRELESS_BRIDGE", "Wireless Bridge", "WB", "#0d9488", 16, "Network Equipment"),
        new("SERVER_RACK", "Server Rack", "SRV", "#7c3aed", 16, "Network Equipment"),
        new("PATCH_PANEL", "Patch Panel", "PP", "#7c3aed", 16, "Network Equipment"),
        new("UPS", "UPS", "UPS", "#7c3aed", 16, "Network Equipment"),
        new("COMPUTER", "Computer", "PC", "#0891b2", 18, "End-User Devices"),
        new("PHONE", "Phone", "TEL", "#0891b2", 18, "End-User Devices"),
        new("TABLET", "Tablet", "TAB", "#0891b2", 18, "End-User Devices"),
        new("PRINTER", "Printer", "PRN", "#0891b2", 18, "End-User Devices"),
        new("IOT_DEVICE", "IoT Device", "IoT", "#0891b2", 18, "End-User Devices"),
        new("CUSTOM", "Custom", "DEV", "#6b7280", 16, "Other"),
    ];

    private static readonly Dictionary<string, DeviceCategoryInfo> ByCategory =
        All.ToDictionary(c => c.Category, StringComparer.Ordinal);

    /// <summary>Unknown categories fall back to CUSTOM's look, like the web map did.</summary>
    public static DeviceCategoryInfo Resolve(string category) =>
        ByCategory.TryGetValue(category, out var info) ? info : ByCategory["CUSTOM"];
}
