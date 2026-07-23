using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using NodeScope.Modules.Inventory.Application.Networks;
using NodeScope.Modules.Inventory.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Devices;

/// <summary>Device wire DTO (the shared <c>DeviceDto</c> - no organizationId, no mobility).</summary>
public sealed record DeviceDto(
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
    DateTime UpdatedAt);

/// <summary>Body of <c>POST /api/v1/devices</c>.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class CreateDeviceRequest
{
    public string? Name { get; init; }

    public string? Category { get; init; }

    public string? NetworkId { get; init; }

    public string? PropertyId { get; init; }

    public string? RoleCode { get; init; }

    public double? Latitude { get; init; }

    public double? Longitude { get; init; }

    public int? Floor { get; init; }

    public string? FloorLabel { get; init; }

    public string? IpAddress { get; init; }

    public string? MacAddress { get; init; }

    public string? Notes { get; init; }

    /// <summary>Node's <c>@Transform(trim)</c> runs before validation.</summary>
    public string? TrimmedName => Name?.Trim();

    public string? TrimmedFloorLabel => FloorLabel?.Trim();

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        RequestValidation.RequireNonEmptyString(errors, TrimmedName, "name");
        RequestValidation.MaxLength(errors, TrimmedName, "name", 100);
        if (DeviceCategoryLabels.TryParse(Category) is null)
        {
            errors.Add("category must be a valid enum value");
        }

        if (NetworkId is null || !Guid.TryParse(NetworkId, out _))
        {
            errors.Add("networkId must be a UUID");
        }

        if (PropertyId is null || !Guid.TryParse(PropertyId, out _))
        {
            errors.Add("propertyId must be a UUID");
        }

        RequestValidation.MaxLength(errors, RoleCode, "roleCode", 32);
        if (Latitude is < -90 or > 90)
        {
            errors.Add("latitude must be a latitude string or number");
        }

        if (Longitude is < -180 or > 180)
        {
            errors.Add("longitude must be a longitude string or number");
        }

        if (Floor is < -10 or > 200)
        {
            errors.Add("floor must not be less than -10 and not greater than 200");
        }

        RequestValidation.MaxLength(errors, TrimmedFloorLabel, "floorLabel", 50);
        if (IpAddress is not null && !NetworkFields.IsIpAddress(IpAddress))
        {
            errors.Add("ipAddress must be an ip address");
        }

        if (MacAddress is not null && !DeviceFields.MacPattern().IsMatch(MacAddress))
        {
            errors.Add("macAddress must be in XX:XX:XX:XX:XX:XX format");
        }

        RequestValidation.MaxLength(errors, Notes, "notes", 500);
        return errors;
    }
}

/// <summary>The changeset surface of a Device (Node's <c>DEVICE_WRITABLE_FIELDS</c>).</summary>
public static partial class DeviceFields
{
    public static readonly IReadOnlyList<string> Writable =
    [
        "name", "category", "networkId", "propertyId", "roleCode", "latitude", "longitude",
        "floor", "floorLabel", "ipAddress", "macAddress", "notes",
    ];

    public const int MaxChanges = 20;

    public static bool IsValid(string field, JsonElement value) => field switch
    {
        "name" => value.ValueKind == JsonValueKind.String && value.GetString()!.Length is >= 1 and <= 100,
        "category" => value.ValueKind == JsonValueKind.String
            && DeviceCategoryLabels.TryParse(value.GetString()) is not null,
        "networkId" or "propertyId" => value.ValueKind == JsonValueKind.String
            && Guid.TryParse(value.GetString(), out _),
        "roleCode" => IsNullOrString(value, 32),
        "latitude" => IsNullOrNumber(value, -90, 90),
        "longitude" => IsNullOrNumber(value, -180, 180),
        "floor" => ChangesetValues.IsNullish(value)
            || (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var floor) && floor is >= -10 and <= 200),
        "floorLabel" => IsNullOrString(value, 50),
        "ipAddress" => ChangesetValues.IsNullish(value)
            || (value.ValueKind == JsonValueKind.String && NetworkFields.IsIpAddress(value.GetString()!)),
        "macAddress" => ChangesetValues.IsNullish(value)
            || (value.ValueKind == JsonValueKind.String && MacPattern().IsMatch(value.GetString()!)),
        "notes" => IsNullOrString(value, 500),
        _ => false,
    };

    [GeneratedRegex("^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$")]
    public static partial Regex MacPattern();

    private static bool IsNullOrString(JsonElement value, int maxLength) =>
        ChangesetValues.IsNullish(value)
        || (value.ValueKind == JsonValueKind.String && value.GetString()!.Length <= maxLength);

    private static bool IsNullOrNumber(JsonElement value, double min, double max) =>
        ChangesetValues.IsNullish(value)
        || (value.ValueKind == JsonValueKind.Number && value.GetDouble() >= min && value.GetDouble() <= max);
}

/// <summary>A Device row as the application layer sees it.</summary>
public sealed record DeviceRecord(
    string Id,
    string OrganizationId,
    string? UserId,
    string NetworkId,
    string PropertyId,
    string? RoleCode,
    string Name,
    DeviceCategory Category,
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
    public DeviceDto ToDto() => new(
        Id, NetworkId, PropertyId, RoleCode, UserId, Name, DeviceCategoryLabels.Of(Category),
        Latitude, Longitude, Floor, FloorLabel, X, Y, Z, IfcGlobalId, IpAddress, MacAddress, Notes,
        Version, CreatedAt, UpdatedAt);
}

/// <summary>Fields of a new Device row.</summary>
public sealed record NewDevice(
    string OrganizationId,
    string? UserId,
    string Name,
    DeviceCategory Category,
    DeviceMobility Mobility,
    string NetworkId,
    string PropertyId,
    string? RoleCode,
    double? Latitude,
    double? Longitude,
    int? Floor,
    string? FloorLabel,
    string? IpAddress,
    string? MacAddress,
    string? Notes);

/// <summary>The offset-paginated list shape <c>{ items, total }</c>.</summary>
public sealed record DeviceListDto(IReadOnlyList<DeviceDto> Items, int Total);

/// <summary>The org's device-naming policy slice (Node read it off the Organization row).</summary>
public sealed record OrgNamingPolicy(string? NamingPattern, int? NamingMaxLen, string? NamingTemplate);

/// <summary>Reader for the Organization columns Inventory consults (naming policy).</summary>
public interface IOrgNamingPolicyReader
{
    /// <summary>Null when the organization row does not exist.</summary>
    public Task<OrgNamingPolicy?> FindAsync(string organizationId, CancellationToken cancellationToken);
}
