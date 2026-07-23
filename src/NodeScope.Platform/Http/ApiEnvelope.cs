using System.Globalization;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http;

namespace NodeScope.Platform.Http;

/// <summary>
/// The Node API's response envelopes, byte-compatible. There was no global interceptor in
/// the Nest code - every controller hand-built <c>{ success, data, timestamp }</c> - so the
/// C# endpoints do the equivalent through these helpers.
/// </summary>
public static class ApiEnvelope
{
    /// <summary>A success envelope with <paramref name="data"/> (which may be an explicit null).</summary>
    public static IResult Ok(object? data, int statusCode = StatusCodes.Status200OK) =>
        Results.Json(new ApiSuccessEnvelope(true, data, IsoTimestamp.Now()), statusCode: statusCode);

    /// <summary>A 201 success envelope, the Nest default for POST.</summary>
    public static IResult Created(object? data) => Ok(data, StatusCodes.Status201Created);
}

/// <summary>Wire shape <c>{ success: true, data, timestamp }</c>.</summary>
public sealed record ApiSuccessEnvelope(bool Success, object? Data, string Timestamp);

/// <summary>Wire shape <c>{ success: false, error: { code, message, details? }, timestamp }</c>.</summary>
public sealed record ApiErrorEnvelope(bool Success, ApiErrorBody Error, string Timestamp);

/// <summary>The <c>error</c> member; <c>details</c> is omitted entirely when absent, like Node.</summary>
public sealed record ApiErrorBody(
    string Code,
    string Message,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<string>? Details);

/// <summary>
/// Timestamps in JavaScript's <c>Date.prototype.toISOString()</c> shape: UTC, exactly
/// millisecond precision, <c>Z</c> suffix. Both envelopes and every DTO date field use it,
/// because that is what every Node response carried.
/// </summary>
public static class IsoTimestamp
{
    private const string Format = "yyyy-MM-dd'T'HH':'mm':'ss'.'fff'Z'";

    public static string Now() => Of(DateTime.UtcNow);

    /// <summary>Formats <paramref name="value"/>; Unspecified kinds are treated as UTC (DB reads).</summary>
    public static string Of(DateTime value)
    {
        var utc = value.Kind == DateTimeKind.Local ? value.ToUniversalTime() : value;
        return utc.ToString(Format, CultureInfo.InvariantCulture);
    }
}
