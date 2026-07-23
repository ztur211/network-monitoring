namespace NodeScope.Modules.Inventory.Domain;

/// <summary>The Postgres <c>DeviceCategory</c> enum (labels via the CONSTANT_CASE translator).</summary>
public enum DeviceCategory
{
    Rad,
    Ont,
    Dslam,
    Router,
    Modem,
    FiberMediaConverter,
    Firewall,
    Switch,
    AccessPoint,
    WifiExtender,
    WirelessBridge,
    ServerRack,
    PatchPanel,
    Ups,
    Computer,
    Phone,
    Tablet,
    Printer,
    IotDevice,
    Custom,
}

/// <summary>The Postgres <c>DeviceMobility</c> enum.</summary>
public enum DeviceMobility
{
    HomeOnly,
    Roams,
    Unknown,
}

/// <summary>Wire-label conversion and the role-code map from Node's <c>role-code.ts</c>.</summary>
public static class DeviceCategoryLabels
{
    private static readonly (DeviceCategory Value, string Label, string RoleCode)[] Table =
    [
        (DeviceCategory.Rad, "RAD", "rad"),
        (DeviceCategory.Ont, "ONT", "ont"),
        (DeviceCategory.Dslam, "DSLAM", "dslam"),
        (DeviceCategory.Router, "ROUTER", "rtr"),
        (DeviceCategory.Modem, "MODEM", "modem"),
        (DeviceCategory.FiberMediaConverter, "FIBER_MEDIA_CONVERTER", "fmc"),
        (DeviceCategory.Firewall, "FIREWALL", "fw"),
        (DeviceCategory.Switch, "SWITCH", "sw"),
        (DeviceCategory.AccessPoint, "ACCESS_POINT", "ap"),
        (DeviceCategory.WifiExtender, "WIFI_EXTENDER", "wx"),
        (DeviceCategory.WirelessBridge, "WIRELESS_BRIDGE", "wb"),
        (DeviceCategory.ServerRack, "SERVER_RACK", "rack"),
        (DeviceCategory.PatchPanel, "PATCH_PANEL", "pp"),
        (DeviceCategory.Ups, "UPS", "ups"),
        (DeviceCategory.Computer, "COMPUTER", "pc"),
        (DeviceCategory.Phone, "PHONE", "phone"),
        (DeviceCategory.Tablet, "TABLET", "tablet"),
        (DeviceCategory.Printer, "PRINTER", "printer"),
        (DeviceCategory.IotDevice, "IOT_DEVICE", "iot"),
        (DeviceCategory.Custom, "CUSTOM", "custom"),
    ];

    private static readonly Dictionary<DeviceCategory, (string Label, string RoleCode)> ByValue =
        Table.ToDictionary(entry => entry.Value, entry => (entry.Label, entry.RoleCode));

    private static readonly Dictionary<string, DeviceCategory> ByLabel =
        Table.ToDictionary(entry => entry.Label, entry => entry.Value, StringComparer.Ordinal);

    public static string Of(DeviceCategory value) => ByValue[value].Label;

    public static DeviceCategory? TryParse(string? label) =>
        label is not null && ByLabel.TryGetValue(label, out var value) ? value : null;

    public static string RoleCodeOf(DeviceCategory value) => ByValue[value].RoleCode;
}
