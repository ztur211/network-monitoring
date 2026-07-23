using System.Text.Json;
using System.Text.Json.Serialization;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Links;

/// <summary>Circuit wire DTO.</summary>
public sealed record CircuitDto(
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

/// <summary>Body of <c>POST /api/v1/circuits</c>.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class CreateCircuitRequest
{
    public string? IspName { get; init; }

    public string? CircuitId { get; init; }

    public string? ServiceType { get; init; }

    public double? Bandwidth { get; init; }

    public string? DeviceId { get; init; }

    public string? Notes { get; init; }

    public string? TrimmedIspName => IspName?.Trim();

    public string? TrimmedCircuitId => CircuitId?.Trim();

    public string? TrimmedServiceType => ServiceType?.Trim();

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        RequestValidation.RequireNonEmptyString(errors, TrimmedIspName, "ispName");
        RequestValidation.MaxLength(errors, TrimmedIspName, "ispName", 100);
        RequestValidation.MaxLength(errors, TrimmedCircuitId, "circuitId", 100);
        RequestValidation.RequireNonEmptyString(errors, TrimmedServiceType, "serviceType");
        RequestValidation.MaxLength(errors, TrimmedServiceType, "serviceType", 50);
        if (Bandwidth is < 0.1 or > 100000)
        {
            errors.Add("bandwidth must not be greater than 100000");
        }

        if (DeviceId is not null && !Guid.TryParse(DeviceId, out _))
        {
            errors.Add("deviceId must be a UUID");
        }

        RequestValidation.MaxLength(errors, Notes, "notes", 500);
        return errors;
    }
}

/// <summary>The changeset surface of a Circuit.</summary>
public static class CircuitFields
{
    public static readonly IReadOnlyList<string> Writable =
        ["ispName", "circuitId", "serviceType", "bandwidth", "deviceId", "notes"];

    public const int MaxChanges = 20;

    public static bool IsValid(string field, JsonElement value) => field switch
    {
        "ispName" => value.ValueKind == JsonValueKind.String && value.GetString()!.Length is >= 1 and <= 100,
        "circuitId" => LinkValues.IsNullOrString(value, 100),
        "serviceType" => value.ValueKind == JsonValueKind.String && value.GetString()!.Length is >= 1 and <= 50,
        "bandwidth" => LinkValues.IsNullOrNumber(value, 0.1, 100000),
        "deviceId" => LinkValues.IsNullOrUuid(value),
        "notes" => LinkValues.IsNullOrString(value, 500),
        _ => false,
    };
}

/// <summary>A Circuit row as the application layer sees it.</summary>
public sealed record CircuitRecord(
    string Id,
    string OrganizationId,
    string? UserId,
    string IspName,
    string? CircuitId,
    string ServiceType,
    double? Bandwidth,
    string? DeviceId,
    string? Notes,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt)
{
    public CircuitDto ToDto() => new(
        Id, UserId, IspName, CircuitId, ServiceType, Bandwidth, DeviceId, Notes, Version, CreatedAt, UpdatedAt);
}

/// <summary>Fields of a new Circuit row.</summary>
public sealed record NewCircuit(
    string OrganizationId,
    string? UserId,
    string IspName,
    string? CircuitId,
    string ServiceType,
    double? Bandwidth,
    string? DeviceId,
    string? Notes);

/// <summary>The cursor-paginated list shape <c>{ items, nextCursor, total }</c>.</summary>
public sealed record CircuitPageDto(IReadOnlyList<CircuitDto> Items, string? NextCursor, int Total);

/// <summary>Shared per-field changeset rules for the link entities.</summary>
internal static class LinkValues
{
    public static bool IsNullOrString(JsonElement value, int maxLength) =>
        ChangesetValues.IsNullish(value)
        || (value.ValueKind == JsonValueKind.String && value.GetString()!.Length <= maxLength);

    public static bool IsNullOrNumber(JsonElement value, double min, double max) =>
        ChangesetValues.IsNullish(value)
        || (value.ValueKind == JsonValueKind.Number && value.GetDouble() >= min && value.GetDouble() <= max);

    public static bool IsNullOrUuid(JsonElement value) =>
        ChangesetValues.IsNullish(value)
        || (value.ValueKind == JsonValueKind.String && Guid.TryParse(value.GetString(), out _));
}
