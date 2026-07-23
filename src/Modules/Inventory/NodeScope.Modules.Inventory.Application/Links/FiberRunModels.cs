using System.Text.Json;
using System.Text.Json.Serialization;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Links;

/// <summary>FiberRun wire DTO.</summary>
public sealed record FiberRunDto(
    string Id,
    string? UserId,
    string Name,
    string StartDeviceId,
    string EndDeviceId,
    string? CableType,
    double? LengthMeters,
    string? Notes,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt);

/// <summary>Body of <c>POST /api/v1/fiber-runs</c>.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class CreateFiberRunRequest
{
    public string? Name { get; init; }

    public string? StartDeviceId { get; init; }

    public string? EndDeviceId { get; init; }

    public string? CableType { get; init; }

    public double? LengthMeters { get; init; }

    public string? Notes { get; init; }

    public string? TrimmedName => Name?.Trim();

    public string? TrimmedCableType => CableType?.Trim();

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        RequestValidation.RequireNonEmptyString(errors, TrimmedName, "name");
        RequestValidation.MaxLength(errors, TrimmedName, "name", 100);
        if (StartDeviceId is null || !Guid.TryParse(StartDeviceId, out _))
        {
            errors.Add("startDeviceId must be a UUID");
        }

        if (EndDeviceId is null || !Guid.TryParse(EndDeviceId, out _))
        {
            errors.Add("endDeviceId must be a UUID");
        }

        RequestValidation.MaxLength(errors, TrimmedCableType, "cableType", 50);
        if (LengthMeters is < 0.1 or > 100000)
        {
            errors.Add("lengthMeters must not be greater than 100000");
        }

        RequestValidation.MaxLength(errors, Notes, "notes", 1000);
        return errors;
    }
}

/// <summary>The changeset surface of a FiberRun (the endpoints are immutable).</summary>
public static class FiberRunFields
{
    public static readonly IReadOnlyList<string> Writable = ["name", "cableType", "lengthMeters", "notes"];

    public const int MaxChanges = 20;

    public static bool IsValid(string field, JsonElement value) => field switch
    {
        "name" => value.ValueKind == JsonValueKind.String && value.GetString()!.Length is >= 1 and <= 100,
        "cableType" => LinkValues.IsNullOrString(value, 50),
        "lengthMeters" => LinkValues.IsNullOrNumber(value, 0.1, 100000),
        "notes" => LinkValues.IsNullOrString(value, 1000),
        _ => false,
    };
}

/// <summary>A FiberRun row as the application layer sees it.</summary>
public sealed record FiberRunRecord(
    string Id,
    string OrganizationId,
    string? UserId,
    string Name,
    string StartDeviceId,
    string EndDeviceId,
    string? CableType,
    double? LengthMeters,
    string? Notes,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt)
{
    public FiberRunDto ToDto() => new(
        Id, UserId, Name, StartDeviceId, EndDeviceId, CableType, LengthMeters, Notes, Version, CreatedAt, UpdatedAt);
}

/// <summary>Fields of a new FiberRun row.</summary>
public sealed record NewFiberRun(
    string OrganizationId,
    string? UserId,
    string Name,
    string StartDeviceId,
    string EndDeviceId,
    string? CableType,
    double? LengthMeters,
    string? Notes);

/// <summary>The flat list shape <c>{ items, total }</c> both link lists answer.</summary>
public sealed record LinkListDto<T>(IReadOnlyList<T> Items, int Total);
