using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Auth;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// The real client code against the real C# host: the only fake is the browser, which
/// performs the authorize hop the way a signed-in browser would (session cookie, no
/// redirect following, Location header back to the app).
/// </summary>
/// <remarks>
/// Env-gated like the agent's snmpd matrix: start the test stack + host
/// (<c>scripts/run-csharp-host.sh</c>) and run with
/// <c>NODESCOPE_DESKTOP_E2E_BASE_URL=http://127.0.0.1:5199</c>; reported as skipped otherwise.
/// </remarks>
public sealed class DesktopAuthE2ETests : IDisposable
{
    private readonly DirectoryInfo _scratch = Directory.CreateTempSubdirectory("nodescope-e2e-");

    public void Dispose() => _scratch.Delete(recursive: true);

    [Fact]
    public async Task The_full_pkce_flow_signs_in_vaults_the_token_and_revoke_kills_the_session()
    {
        if (OperatingSystem.IsWindows())
        {
            // The guard doubles as the CA1416 platform fence for the plain-file vault below.
            Assert.Skip("the E2E drives the Linux dev-loop vault; Windows runs use DPAPI");
            return;
        }

        var configured = Environment.GetEnvironmentVariable("NODESCOPE_DESKTOP_E2E_BASE_URL");
        Assert.SkipWhen(string.IsNullOrEmpty(configured),
            "set NODESCOPE_DESKTOP_E2E_BASE_URL (test stack + scripts/run-csharp-host.sh) to run");

        var server = new Uri(configured);
        var vault = new PlainFileTokenVault(Path.Combine(_scratch.FullName, "vault.json"));
        var settings = new SettingsStore(Path.Combine(_scratch.FullName, "settings.json"));
        using var browser = new CookieSessionBrowser(server);
        using var factory = new ApplianceClientFactory();
        using var flow = new DesktopAuthFlow(
            factory, vault, settings, browser, NullLogger<DesktopAuthFlow>.Instance);

        var email = await browser.SignUpAsync();

        flow.StartSignIn(server);
        Assert.Equal(SessionPhase.WaitingForBrowser, flow.Current.Phase);

        var callback = await browser.CompleteAuthorizeAsync();
        await flow.HandleCallbackAsync(callback, CancellationToken.None);

        Assert.Equal(SessionPhase.SignedIn, flow.Current.Phase);
        Assert.Equal(email, flow.Current.User?.Email);
        var vaulted = vault.Load();
        Assert.NotNull(vaulted);

        // The vaulted token is a live Bearer credential...
        using var probe = factory.Create(server);
        var me = await probe.GetCurrentUserAsync(vaulted.Token, CancellationToken.None);
        Assert.Equal(email, me.Email);

        // ...until sign-out revokes it server-side.
        await flow.SignOutAsync(CancellationToken.None);
        Assert.Null(vault.Load());
        var afterRevoke = await Assert.ThrowsAsync<ApplianceApiException>(
            () => probe.GetCurrentUserAsync(vaulted.Token, CancellationToken.None));
        Assert.Equal(401, afterRevoke.Status);
    }

    /// <summary>
    /// Plays the user's browser: holds the web session cookie from a real sign-up and
    /// executes the authorize URL the flow hands to <see cref="IBrowserLauncher.Open"/>.
    /// </summary>
    private sealed class CookieSessionBrowser : IBrowserLauncher, IDisposable
    {
        private readonly HttpClientHandler _handler = new() { UseCookies = false, AllowAutoRedirect = false };
        private readonly HttpClient _http;
        private string? _cookie;
        private Uri? _authorizeUrl;

        public CookieSessionBrowser(Uri server)
        {
            _http = new HttpClient(_handler, disposeHandler: false) { BaseAddress = server };
        }

        public void Open(Uri url) => _authorizeUrl = url;

        public void Dispose()
        {
            _http.Dispose();
            _handler.Dispose();
        }

        /// <summary>Real sign-up over the Better Auth shim; keeps the session cookie.</summary>
        public async Task<string> SignUpAsync()
        {
            var email = $"desktop-e2e-{Guid.NewGuid():N}@example.com";
            using var body = JsonContent.Create(new { email, password = "Password123!", name = "Desktop E2E" });
            using var response = await _http.PostAsync(
                new Uri("api/auth/sign-up/email", UriKind.Relative), body);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);

            var setCookie = response.Headers.GetValues("Set-Cookie")
                .First(value => value.StartsWith("better-auth.session_token=", StringComparison.Ordinal));
            _cookie = setCookie[..setCookie.IndexOf(';', StringComparison.Ordinal)];
            return email;
        }

        /// <summary>The authorize hop: cookie in, nodescope:// Location out.</summary>
        public async Task<Uri> CompleteAuthorizeAsync()
        {
            Assert.NotNull(_authorizeUrl); // the flow must have "opened" the browser first
            using var request = new HttpRequestMessage(HttpMethod.Get, _authorizeUrl);
            request.Headers.Add("Cookie", _cookie);
            using var response = await _http.SendAsync(request);

            Assert.Equal(HttpStatusCode.Found, response.StatusCode);
            var location = response.Headers.Location;
            Assert.NotNull(location);
            Assert.StartsWith("nodescope://auth/callback?", location.AbsoluteUri, StringComparison.Ordinal);
            return location;
        }
    }
}
