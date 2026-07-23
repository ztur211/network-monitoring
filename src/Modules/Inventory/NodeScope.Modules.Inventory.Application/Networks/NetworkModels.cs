using System.Text.Json;
using System.Text.Json.Serialization;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Networks;

/// <summary>Network list shape - never carries <c>homePublicIp</c>.</summary>
public sealed record NetworkSummaryDto(
    string Id,
    string Name,
    string? HomeAddress,
    double? HomeLatitude,
    double? HomeLongitude,
    string? Isp,
    double? DownMbps,
    double? UpMbps,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt);

/// <summary>Network detail shape - the summary plus <c>homePublicIp</c>.</summary>
public sealed record NetworkDetailDto(
    string Id,
    string Name,
    string? HomeAddress,
    double? HomeLatitude,
    double? HomeLongitude,
    string? Isp,
    double? DownMbps,
    double? UpMbps,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    string? HomePublicIp);

/// <summary>Body of <c>POST /api/v1/networks</c>.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class CreateNetworkRequest
{
    public string? Name { get; init; }

    public string? HomeAddress { get; init; }

    public double? HomeLatitude { get; init; }

    public double? HomeLongitude { get; init; }

    public string? HomePublicIp { get; init; }

    public string? Isp { get; init; }

    public double? DownMbps { get; init; }

    public double? UpMbps { get; init; }

    /// <summary>Node's <c>@Transform(trim)</c> runs before validation, so validate the trimmed name.</summary>
    public string? TrimmedName => Name?.Trim();

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        RequestValidation.RequireNonEmptyString(errors, TrimmedName, "name");
        RequestValidation.MaxLength(errors, TrimmedName, "name", 100);
        RequestValidation.MaxLength(errors, HomeAddress, "homeAddress", 255);
        if (HomeLatitude is < -90 or > 90)
        {
            errors.Add("homeLatitude must be a latitude string or number");
        }

        if (HomeLongitude is < -180 or > 180)
        {
            errors.Add("homeLongitude must be a longitude string or number");
        }

        if (HomePublicIp is not null && !NetworkFields.IsIpAddress(HomePublicIp))
        {
            errors.Add("homePublicIp must be an ip address");
        }

        RequestValidation.MaxLength(errors, Isp, "isp", 100);
        if (DownMbps is < 0 or > 100000)
        {
            errors.Add("downMbps must not be greater than 100000");
        }

        if (UpMbps is < 0 or > 100000)
        {
            errors.Add("upMbps must not be greater than 100000");
        }

        return errors;
    }
}

/// <summary>The changeset surface of a Network (Node's <c>NETWORK_WRITABLE_FIELDS</c>).</summary>
public static class NetworkFields
{
    public static readonly IReadOnlyList<string> Writable =
        ["name", "homeAddress", "homeLatitude", "homeLongitude", "homePublicIp", "isp", "downMbps", "upMbps"];

    public const int MaxChanges = 20;

    public static bool IsValid(string field, JsonElement value) => field switch
    {
        "name" => value.ValueKind == JsonValueKind.String && value.GetString()!.Length is >= 1 and <= 100,
        "homeAddress" => IsNullOrString(value, 255),
        "homeLatitude" => IsNullOrNumber(value, -90, 90),
        "homeLongitude" => IsNullOrNumber(value, -180, 180),
        "homePublicIp" => ChangesetValues.IsNullish(value)
            || (value.ValueKind == JsonValueKind.String && IsIpAddress(value.GetString()!)),
        "isp" => IsNullOrString(value, 100),
        "downMbps" => IsNullOrNumber(value, 0, 100000),
        "upMbps" => IsNullOrNumber(value, 0, 100000),
        _ => false,
    };

    /// <summary>validator.js <c>isIP</c>: full dotted-quad v4 or a colon-separated v6.</summary>
    public static bool IsIpAddress(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        return System.Net.IPAddress.TryParse(value, out var parsed)
        && parsed.ToString().Length > 0
            && (value.Contains(':', StringComparison.Ordinal) || value.Count(c => c == '.') == 3);
    }

    private static bool IsNullOrString(JsonElement value, int maxLength) =>
        ChangesetValues.IsNullish(value)
        || (value.ValueKind == JsonValueKind.String && value.GetString()!.Length <= maxLength);

    private static bool IsNullOrNumber(JsonElement value, double min, double max) =>
        ChangesetValues.IsNullish(value)
        || (value.ValueKind == JsonValueKind.Number && value.GetDouble() >= min && value.GetDouble() <= max);
}

/// <summary>A Network row as the application layer sees it.</summary>
public sealed record NetworkRecord(
    string Id,
    string OrganizationId,
    string? UserId,
    string Name,
    string? HomeAddress,
    double? HomeLatitude,
    double? HomeLongitude,
    string? HomePublicIp,
    string? Isp,
    double? DownMbps,
    double? UpMbps,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt)
{
    public NetworkSummaryDto ToSummary() => new(
        Id, Name, HomeAddress, HomeLatitude, HomeLongitude, Isp, DownMbps, UpMbps, Version, CreatedAt, UpdatedAt);

    public NetworkDetailDto ToDetail() => new(
        Id, Name, HomeAddress, HomeLatitude, HomeLongitude, Isp, DownMbps, UpMbps, Version, CreatedAt, UpdatedAt,
        HomePublicIp);
}

/// <summary>Fields of a new Network row.</summary>
public sealed record NewNetwork(
    string OrganizationId,
    string? UserId,
    string Name,
    string? HomeAddress,
    double? HomeLatitude,
    double? HomeLongitude,
    string? HomePublicIp,
    string? Isp,
    double? DownMbps,
    double? UpMbps);
