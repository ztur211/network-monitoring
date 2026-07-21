namespace NodeScope.ContractTests.Fixtures;

/// <summary>
/// How a single request authenticates. The API accepts three credential families
/// (Decision 7): a user session as either a cookie or a Bearer token, and machine
/// tokens carried in custom headers. This models all of them at the wire level so
/// the tests never assume which implementation is answering.
/// </summary>
public sealed class Auth
{
    private Auth(string? bearerToken, string? cookie, IReadOnlyDictionary<string, string>? headers)
    {
        BearerToken = bearerToken;
        Cookie = cookie;
        Headers = headers;
    }

    /// <summary>Value for an <c>Authorization: Bearer</c> header, if any.</summary>
    public string? BearerToken { get; }

    /// <summary>Raw <c>Cookie</c> header value, e.g. <c>better-auth.session_token=...</c>.</summary>
    public string? Cookie { get; }

    /// <summary>Extra request headers, e.g. <c>x-agent-token</c> or <c>x-ingest-token</c>.</summary>
    public IReadOnlyDictionary<string, string>? Headers { get; }

    /// <summary>Authenticate with the raw session token as a Bearer credential (bearer plugin).</summary>
    public static Auth Bearer(string token) => new(token, null, null);

    /// <summary>Authenticate with a session cookie value (<c>name=value</c>).</summary>
    public static Auth WithCookie(string cookie) => new(null, cookie, null);

    /// <summary>Authenticate with a single custom header, e.g. an agent or ingest token.</summary>
    public static Auth WithHeader(string name, string value) =>
        new(null, null, new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { [name] = value });

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
        return new Auth(BearerToken, Cookie, headers);
    }
}
