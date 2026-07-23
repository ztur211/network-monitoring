namespace NodeScope.Modules.Inventory.Domain;

/// <summary>The Postgres <c>PropertyType</c> enum (labels via the CONSTANT_CASE translator).</summary>
public enum PropertyType
{
    Site,
    Building,
    Floor,
    Area,
}

/// <summary>Wire-label conversion (the DB labels are the wire values).</summary>
public static class PropertyTypeLabels
{
    public static string Of(PropertyType value) => value switch
    {
        PropertyType.Site => "SITE",
        PropertyType.Building => "BUILDING",
        PropertyType.Floor => "FLOOR",
        PropertyType.Area => "AREA",
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };

    public static PropertyType? TryParse(string? label) => label switch
    {
        "SITE" => PropertyType.Site,
        "BUILDING" => PropertyType.Building,
        "FLOOR" => PropertyType.Floor,
        "AREA" => PropertyType.Area,
        _ => null,
    };
}
