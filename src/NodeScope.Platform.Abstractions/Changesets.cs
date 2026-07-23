using System.Text.Json;
using System.Text.Json.Serialization;

namespace NodeScope.Platform.Abstractions;

/// <summary>
/// The optimistic-concurrency PATCH body every versioned entity shares
/// (Node's <c>ChangesetDto</c>): <c>{ baseVersion, changes: [{ field, oldValue, newValue }] }</c>.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class ChangesetRequest
{
    public int? BaseVersion { get; init; }

    public IReadOnlyList<ChangesetChange>? Changes { get; init; }

    /// <summary>Structural validation (the Nest ValidationPipe layer); field rules run later.</summary>
    public IReadOnlyList<string> Validate(int maxChanges)
    {
        var errors = new List<string>();
        if (BaseVersion is null)
        {
            errors.Add("baseVersion must be an integer number");
        }
        else if (BaseVersion < 1)
        {
            errors.Add("baseVersion must not be less than 1");
        }

        if (Changes is null || Changes.Count == 0)
        {
            errors.Add("changes must contain at least 1 elements");
        }
        else if (Changes.Count > maxChanges)
        {
            errors.Add($"changes must contain no more than {maxChanges} elements");
        }

        for (var i = 0; i < (Changes?.Count ?? 0); i++)
        {
            if (Changes![i].Field is null)
            {
                errors.Add($"changes.{i}.field must be a string");
            }
        }

        return errors;
    }
}

/// <summary>
/// One field-level change. Values stay raw <see cref="JsonElement"/>s
/// (<c>Undefined</c> = the member was absent, mirroring Prisma's ignore-undefined).
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class ChangesetChange
{
    public string? Field { get; init; }

    public JsonElement OldValue { get; init; }

    public JsonElement NewValue { get; init; }
}

/// <summary>
/// Changeset application, ported from the Node <c>ConflictResolutionService</c>: version
/// gate, writable-field allowlist, and per-field value validation against the same rules
/// the create endpoint enforces.
/// </summary>
public static class Changesets
{
    public static ApiException EditConflict() => new("SYNC_001", "EDIT_CONFLICT", 409);

    /// <summary>
    /// Maps <paramref name="changeset"/> to a field -&gt; newValue payload.
    /// Throws <c>SYNC_001</c> on a stale <c>baseVersion</c>, <c>GEN_001</c> on a
    /// non-writable field or a value <paramref name="isValidField"/> rejects.
    /// </summary>
    public static Dictionary<string, JsonElement> BuildUpdatePayload(
        ChangesetRequest changeset,
        IReadOnlyList<string> writableFields,
        int currentVersion,
        Func<string, JsonElement, bool>? isValidField = null)
    {
        ArgumentNullException.ThrowIfNull(changeset);
        ArgumentNullException.ThrowIfNull(writableFields);
        if (changeset.BaseVersion != currentVersion)
        {
            throw EditConflict();
        }

        var payload = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var change in changeset.Changes ?? [])
        {
            var field = change.Field!;
            if (!writableFields.Contains(field, StringComparer.Ordinal))
            {
                throw new ApiException("GEN_001", $"Field '{field}' is not writable", 400);
            }

            if (isValidField is not null && !isValidField(field, change.NewValue))
            {
                throw new ApiException("GEN_001", $"Invalid value for field '{field}'", 400);
            }

            payload[field] = change.NewValue;
        }

        return payload;
    }
}

/// <summary>Audit-trail projection of a changeset (Node's <c>String(v)</c> stringification).</summary>
public static class ChangesetAudit
{
    public static IReadOnlyList<AuditFieldChange> ToFieldChanges(ChangesetRequest changeset)
    {
        ArgumentNullException.ThrowIfNull(changeset);
        return [.. (changeset.Changes ?? []).Select(change => new AuditFieldChange(
            change.Field!,
            Stringify(change.OldValue),
            Stringify(change.NewValue)))];
    }

    private static string? Stringify(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => null,
        JsonValueKind.String => value.GetString(),
        _ => value.GetRawText(),
    };
}

/// <summary>Converters from changeset <see cref="JsonElement"/> values to column types.</summary>
public static class ChangesetValues
{
    public static bool IsNullish(JsonElement value) =>
        value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined;

    public static string? AsString(JsonElement value) =>
        IsNullish(value) ? null : value.GetString();

    public static double? AsDouble(JsonElement value) =>
        IsNullish(value) ? null : value.GetDouble();

    public static int? AsInt32(JsonElement value) =>
        IsNullish(value) ? null : value.GetInt32();
}
