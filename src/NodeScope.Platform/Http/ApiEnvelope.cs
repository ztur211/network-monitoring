using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http;
using NodeScope.Platform.Abstractions;

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

