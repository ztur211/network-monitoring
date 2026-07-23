namespace NodeScope.Modules.Inventory.Domain;

/// <summary>The Postgres <c>ConnectionType</c> enum (labels via the CONSTANT_CASE translator).</summary>
public enum ConnectionType
{
    Ethernet,
    Fiber,
    Wifi,
    Logical,
}

/// <summary>Wire-label conversion (the DB labels are the wire values).</summary>
public static class ConnectionTypeLabels
{
    public static string Of(ConnectionType value) => value switch
    {
        ConnectionType.Ethernet => "ETHERNET",
        ConnectionType.Fiber => "FIBER",
        ConnectionType.Wifi => "WIFI",
        ConnectionType.Logical => "LOGICAL",
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };

    public static ConnectionType? TryParse(string? label) => label switch
    {
        "ETHERNET" => ConnectionType.Ethernet,
        "FIBER" => ConnectionType.Fiber,
        "WIFI" => ConnectionType.Wifi,
        "LOGICAL" => ConnectionType.Logical,
        _ => null,
    };
}
