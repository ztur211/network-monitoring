namespace NodeScope.ContractTests.Fixtures;

/// <summary>
/// How a single request authenticates. The API accepts two credential families:
/// a user session as a raw Bearer token (the native wire - the cookie form died
/// with the Better Auth shim), and machine tokens carried in custom headers. This
/// models both at the wire level so the tests never assume which implementation
/// is answering.
/// </summary>
public sealed class Auth
{
    private Auth(string? bearerToken, IReadOnlyDictionary<string, string>? headers)
    {
        BearerToken = bearerToken;
        Headers = headers;
    }

    /// <summary>Value for an <c>Authorization: Bearer</c> header, if any.</summary>
    public string? BearerToken { get; }

    /// <summary>Extra request headers, e.g. <c>x-agent-token</c> or <c>x-ingest-token</c>.</summary>
    public IReadOnlyDictionary<string, string>? Headers { get; }

    /// <summary>Authenticate with the raw session token as a Bearer credential.</summary>
    public static Auth Bearer(string token) => new(token, null);

    /// <summary>Authenticate with a single custom header, e.g. an agent or ingest token.</summary>
    public static Auth WithHeader(string name, string value) =>
        new(null, new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { [name] = value });

    /// <summary>
    /// This credential plus one extra request header (e.g. a User-Agent), for
    /// endpoints whose contract reads request headers alongside the session.
    /// </summary>
    public Auth WithExtraHeader(string name, string value)
    {
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (Headers is not null)
        {
            foreach (var (key, existing) in Headers)
            {
                headers[key] = existing;
            }
        }

        headers[name] = value;
        return new Auth(BearerToken, headers);
    }
}
