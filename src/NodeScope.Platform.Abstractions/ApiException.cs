namespace NodeScope.Platform.Abstractions;

/// <summary>
/// The one exception type that is allowed to reach the wire. Mirrors the Node API's
/// <c>NodeScopeException</c>: a stable machine-readable <see cref="Code"/>, a short
/// message, the HTTP status, and optionally per-field validation details. Anything else
/// escaping a request is a bug and surfaces as 500 <c>GEN_003</c>.
/// </summary>
public sealed class ApiException : Exception
{
    public ApiException(string code, string message, int statusCode, IReadOnlyList<string>? details = null)
        : base(message)
    {
        Code = code;
        StatusCode = statusCode;
        Details = details;
    }

    // The standard constructors (CA1032) deliberately degrade to the filter's
    // unhandled-exception mapping: no code means internal error.
    public ApiException()
        : this("GEN_003", "INTERNAL_ERROR", 500)
    {
    }

    public ApiException(string message)
        : this("GEN_003", message, 500)
    {
    }

    public ApiException(string message, Exception innerException)
        : base(message, innerException)
    {
        Code = "GEN_003";
        StatusCode = 500;
    }

    /// <summary>Stable error code, e.g. <c>ORG_002</c>. Part of the HTTP contract.</summary>
    public string Code { get; }

    /// <summary>HTTP status this error maps to.</summary>
    public int StatusCode { get; }

    /// <summary>Optional detail lines (only validation errors carry these).</summary>
    public IReadOnlyList<string>? Details { get; }
}
