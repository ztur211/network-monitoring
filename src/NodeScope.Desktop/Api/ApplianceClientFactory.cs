using System.Reflection;

namespace NodeScope.Desktop.Api;

/// <summary>
/// Creates <see cref="ApplianceClient"/>s over one shared connection pool. The handler
/// outlives individual clients (server-URL changes) so sockets are reused and DNS rotates
/// per the pool lifetime.
/// </summary>
internal sealed class ApplianceClientFactory : IApplianceClientFactory, IDisposable
{
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(30);

    /// <summary>
    /// Identifies this client to the appliance; <c>GET /clients</c> echoes it back as
    /// "the current device", so it should say what this actually is.
    /// </summary>
    private static readonly string UserAgent = string.Create(
        null,
        $"NodeScope-Desktop/{typeof(ApplianceClientFactory).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0"} "
        + $"({Environment.OSVersion.Platform})");

    private readonly SocketsHttpHandler _handler = new()
    {
        // The appliance sets cookies for the browser flow; the desktop client is Bearer-only
        // and must never accidentally hold a cookie session.
        UseCookies = false,
        PooledConnectionLifetime = TimeSpan.FromMinutes(5),
    };

    public IApplianceClient Create(Uri baseUrl)
    {
        // A trailing slash makes relative-Uri composition keep the full path; without it
        // "api/..." would replace the last segment of a base URL like "https://host/nodescope".
        var normalized = baseUrl.AbsoluteUri.EndsWith('/') ? baseUrl : new Uri(baseUrl.AbsoluteUri + "/");
        var http = new HttpClient(_handler, disposeHandler: false)
        {
            BaseAddress = normalized,
            Timeout = RequestTimeout,
        };
        http.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", UserAgent);
        return new ApplianceClient(http, normalized);
    }

    public void Dispose() => _handler.Dispose();
}
