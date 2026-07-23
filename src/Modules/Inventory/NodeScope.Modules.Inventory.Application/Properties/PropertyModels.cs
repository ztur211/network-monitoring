using System.Text.Json;
using System.Text.Json.Serialization;
using NodeScope.Modules.Inventory.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Properties;

/// <summary>Property wire DTO (Node's <c>PropertyDto</c>).</summary>
public sealed record PropertyDto(
    string Id,
    string OrganizationId,
    string? ParentId,
    string Type,
    string Name,
    string? Code,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt);

/// <summary>Body of <c>POST /api/v1/properties</c>.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class CreatePropertyRequest
{
    public string? Type { get; init; }

    public string? ParentId { get; init; }

    public string? Name { get; init; }

    public string? Code { get; init; }

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        if (PropertyTypeLabels.TryParse(Type) is null)
        {
            errors.Add("type must be one of the following values: SITE, BUILDING, FLOOR, AREA");
        }

        if (ParentId is not null && !Guid.TryParse(ParentId, out _))
        {
            errors.Add("parentId must be a UUID");
        }

        RequestValidation.RequireNonEmptyString(errors, Name, "name");
        RequestValidation.MaxLength(errors, Name, "name", 120);
        RequestValidation.MaxLength(errors, Code, "code", 32);
        return errors;
    }
}

/// <summary>The changeset surface of a Property (Node's <c>PROPERTY_WRITABLE_FIELDS</c>).</summary>
public static class PropertyFields
{
    public static readonly IReadOnlyList<string> Writable = ["name", "code", "parentId"];

    public const int MaxChanges = 10;

    /// <summary>Per-field rules matching <c>CreatePropertyDto</c> under skip-undefined semantics.</summary>
    public static bool IsValid(string field, JsonElement value) => field switch
    {
        // Required on create, so an explicit null is invalid.
        "name" => value.ValueKind == JsonValueKind.String
            && value.GetString()!.Length is >= 1 and <= 120,
        "code" => ChangesetValues.IsNullish(value)
            || (value.ValueKind == JsonValueKind.String && value.GetString()!.Length <= 32),
        "parentId" => ChangesetValues.IsNullish(value)
            || (value.ValueKind == JsonValueKind.String && Guid.TryParse(value.GetString(), out _)),
        _ => false,
    };
}

/// <summary>A Property row as the application layer sees it.</summary>
public sealed record PropertyRecord(
    string Id,
    string OrganizationId,
    string? ParentId,
    PropertyType Type,
    string Name,
    string? Code,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt)
{
    public PropertyDto ToDto() => new(
        Id, OrganizationId, ParentId, PropertyTypeLabels.Of(Type), Name, Code, Version, CreatedAt, UpdatedAt);
}

/// <summary>Fields of a new Property row.</summary>
public sealed record NewProperty(
    string OrganizationId,
    string? ParentId,
    PropertyType Type,
    string Name,
    string? Code);
