using System.Text.Json;

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

    /// <summary>
    /// True when the appliance serves the rasterized map style - false means the region
    /// extract has not been built yet (<c>nodescope.sh tiles</c>) and tiles would 404.
    /// </summary>
    public Task<bool> ProbeTilesAsync(CancellationToken cancellationToken);

    /// <summary><c>GET /api/v1/devices</c>: the full fleet (seeds the map's device cache).</summary>
    public Task<IReadOnlyList<MapDevice>> GetDevicesAsync(string bearerToken, CancellationToken cancellationToken);

    /// <summary><c>GET /api/v1/map/devices?bbox=…[&amp;floor=…]</c>: devices located inside the box.</summary>
    public Task<IReadOnlyList<MapDevice>> GetMapDevicesAsync(
        string bearerToken, MapBbox bbox, int? floor, CancellationToken cancellationToken);

    /// <summary><c>GET /api/v1/map/fiber-runs?bbox=…</c>: runs with either endpoint inside the box.</summary>
    public Task<IReadOnlyList<MapFiberRun>> GetMapFiberRunsAsync(
        string bearerToken, MapBbox bbox, CancellationToken cancellationToken);

    /// <summary>
    /// <c>GET /api/v1/users/me/preferences</c>: the free-form preferences JSON the clients
    /// share (the server stores it verbatim). Null when none were ever saved.
    /// </summary>
    public Task<JsonElement?> GetPreferencesAsync(string bearerToken, CancellationToken cancellationToken);

    /// <summary><c>PUT /api/v1/users/me/preferences</c>: replaces the shared preferences JSON.</summary>
    public Task PutPreferencesAsync(
        string bearerToken, JsonElement preferences, CancellationToken cancellationToken);
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
