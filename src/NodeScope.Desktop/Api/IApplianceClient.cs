namespace NodeScope.Desktop.Api;

/// <summary>HTTP surface of one appliance, as far as the client needs it so far.</summary>
internal interface IApplianceClient : IDisposable
{
    public Uri BaseUrl { get; }

    /// <summary>
    /// <c>POST /api/v1/desktop-auth/token</c>: burns the one-time code against its PKCE
    /// verifier and returns the session token to use as a Bearer credential.
    /// </summary>
    public Task<string> ExchangeDesktopCodeAsync(string code, string codeVerifier, CancellationToken cancellationToken);

    /// <summary><c>GET /api/v1/users/me</c> with the Bearer credential.</summary>
    public Task<CurrentUser> GetCurrentUserAsync(string bearerToken, CancellationToken cancellationToken);

    /// <summary><c>POST /api/v1/desktop-auth/revoke</c>: deletes the session behind the token.</summary>
    public Task RevokeAsync(string bearerToken, CancellationToken cancellationToken);
}

/// <summary>
/// Creates a client for a given appliance URL. A factory because the URL is user
/// configuration, not deployment configuration - the sign-in screen can point the client
/// at a different appliance at any time.
/// </summary>
internal interface IApplianceClientFactory
{
    public IApplianceClient Create(Uri baseUrl);
}
