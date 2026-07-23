using System.Text.Json;
using System.Text.Json.Serialization;
using NodeScope.Modules.Inventory.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Links;

/// <summary>DeviceConnection wire DTO.</summary>
public sealed record ConnectionDto(
    string Id,
    string? UserId,
    string SourceDeviceId,
    string TargetDeviceId,
    string ConnectionType,
    string? Notes,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt);

/// <summary>Body of <c>POST /api/v1/device-connections</c>.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class CreateConnectionRequest
{
    public string? SourceDeviceId { get; init; }

    public string? TargetDeviceId { get; init; }

    public string? ConnectionType { get; init; }

    public string? Notes { get; init; }

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        if (SourceDeviceId is null || !Guid.TryParse(SourceDeviceId, out _))
        {
            errors.Add("sourceDeviceId must be a UUID");
        }

        if (TargetDeviceId is null || !Guid.TryParse(TargetDeviceId, out _))
        {
            errors.Add("targetDeviceId must be a UUID");
        }

        if (ConnectionTypeLabels.TryParse(ConnectionType) is null)
        {
            errors.Add("connectionType must be one of the following values: ETHERNET, FIBER, WIFI, LOGICAL");
        }

        RequestValidation.MaxLength(errors, Notes, "notes", 500);
        return errors;
    }
}

/// <summary>The changeset surface of a DeviceConnection (the endpoints are immutable).</summary>
public static class ConnectionFields
{
    public static readonly IReadOnlyList<string> Writable = ["connectionType", "notes"];

    public const int MaxChanges = 10;

    public static bool IsValid(string field, JsonElement value) => field switch
    {
        "connectionType" => value.ValueKind == JsonValueKind.String
            && ConnectionTypeLabels.TryParse(value.GetString()) is not null,
        "notes" => LinkValues.IsNullOrString(value, 500),
        _ => false,
    };
}

/// <summary>A DeviceConnection row as the application layer sees it.</summary>
public sealed record ConnectionRecord(
    string Id,
    string OrganizationId,
    string? UserId,
    string SourceDeviceId,
    string TargetDeviceId,
    ConnectionType ConnectionType,
    string? Notes,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt)
{
    public ConnectionDto ToDto() => new(
        Id, UserId, SourceDeviceId, TargetDeviceId, ConnectionTypeLabels.Of(ConnectionType), Notes,
        Version, CreatedAt, UpdatedAt);
}

/// <summary>Fields of a new DeviceConnection row.</summary>
public sealed record NewConnection(
    string OrganizationId,
    string? UserId,
    string SourceDeviceId,
    string TargetDeviceId,
    ConnectionType ConnectionType,
    string? Notes);
