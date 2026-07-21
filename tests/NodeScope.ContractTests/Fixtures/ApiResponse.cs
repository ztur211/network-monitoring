using System.Net.Http.Headers;

namespace NodeScope.ContractTests.Fixtures;

/// <summary>
/// A captured HTTP response: status, headers, any <c>Set-Cookie</c> values, and the
/// body parsed once as JSON. Everything the tests read is copied off the live
/// <see cref="HttpResponseMessage"/> so the response can be disposed immediately.
/// </summary>
public sealed class ApiResponse
{
    private const string SessionCookieName = "better-auth.session_token";

    private ApiResponse(
        HttpStatusCode status,
        string body,
        JsonElement json,
        IReadOnlyList<string> setCookies,
        IReadOnlyDictionary<string, string> headers)
    {
        Status = status;
        Body = body;
        Json = json;
        SetCookies = setCookies;
        Headers = headers;
    }

    /// <summary>The HTTP status.</summary>
    public HttpStatusCode Status { get; }

    /// <summary>The HTTP status as an integer, for terse assertions.</summary>
    public int StatusCode => (int)Status;

    /// <summary>The raw response body.</summary>
    public string Body { get; }

    /// <summary>
    /// The body parsed as JSON, or a default element (<see cref="JsonValueKind.Undefined"/>)
    /// when the body is empty or not JSON.
    /// </summary>
    public JsonElement Json { get; }

    /// <summary>Every <c>Set-Cookie</c> header value, verbatim.</summary>
    public IReadOnlyList<string> SetCookies { get; }

    /// <summary>Response headers, first value each, keyed case-insensitively.</summary>
    public IReadOnlyDictionary<string, string> Headers { get; }

    /// <summary>True for a 2xx status.</summary>
    public bool IsSuccess => StatusCode is >= 200 and < 300;

    /// <summary>A single response header value, or null if absent.</summary>
    public string? Header(string name) => Headers.TryGetValue(name, out var value) ? value : null;

    /// <summary>
    /// The <c>data</c> member of the standard success envelope
    /// (<c>{ success, data, timestamp }</c>). Throws if the body is not an object
    /// with that member - call it only after asserting a success response.
    /// </summary>
    public JsonElement Data => Json.GetProperty("data");

    /// <summary>
    /// The <c>error.code</c> of the standard error envelope
    /// (<c>{ success:false, error:{ code, message }, timestamp }</c>), or null when
    /// the body carries no such error.
    /// </summary>
    public string? ErrorCode
    {
        get
        {
            if (Json.ValueKind == JsonValueKind.Object
                && Json.TryGetProperty("error", out var error)
                && error.ValueKind == JsonValueKind.Object
                && error.TryGetProperty("code", out var code))
            {
                return code.GetString();
            }

            return null;
        }
    }

    /// <summary>
    /// The <c>better-auth.session_token</c> cookie as a <c>name=value</c> pair ready to
    /// send back as a <c>Cookie</c> header, or null if this response did not set it.
    /// </summary>
    public string? SessionTokenCookie
    {
        get
        {
            foreach (var cookie in SetCookies)
            {
                if (cookie.StartsWith(SessionCookieName + "=", StringComparison.Ordinal))
                {
                    var end = cookie.IndexOf(';', StringComparison.Ordinal);
                    return end < 0 ? cookie : cookie[..end];
                }
            }

            return null;
        }
    }

    internal static ApiResponse Capture(
        HttpStatusCode status,
        HttpResponseHeaders headers,
        HttpContentHeaders contentHeaders,
        IReadOnlyList<string> setCookies,
        string body)
    {
        JsonElement json = default;
        if (!string.IsNullOrWhiteSpace(body))
        {
            try
            {
                using var document = JsonDocument.Parse(body);
                json = document.RootElement.Clone();
            }
            catch (JsonException)
            {
                // Non-JSON body (e.g. a plain-text health probe failure); leave Json undefined.
            }
        }

        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var header in headers)
        {
            map[header.Key] = string.Join(",", header.Value);
        }

        foreach (var header in contentHeaders)
        {
            map[header.Key] = string.Join(",", header.Value);
        }

        return new ApiResponse(status, body, json, setCookies, map);
    }
}
