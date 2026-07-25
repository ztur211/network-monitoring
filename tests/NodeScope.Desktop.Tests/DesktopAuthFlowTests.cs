using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Auth;
using NodeScope.Desktop.Tests.Fakes;
using Xunit;

namespace NodeScope.Desktop.Tests;

public sealed class DesktopAuthFlowTests : IDisposable
{
    private static readonly Uri Server = new("https://appliance.local/");

    private readonly DirectoryInfo _scratch = Directory.CreateTempSubdirectory("nodescope-flow-tests-");
    private readonly FakeApplianceClientFactory _clients = new();
    private readonly FakeBrowserLauncher _browser = new();
    private readonly InMemoryTokenVault _vault = new();
    private readonly TestClock _clock = new(new DateTimeOffset(2026, 7, 25, 12, 0, 0, TimeSpan.Zero));
    private readonly SettingsStore _settings;
    private readonly DesktopAuthFlow _flow;

    public DesktopAuthFlowTests()
    {
        _settings = new SettingsStore(Path.Combine(_scratch.FullName, "settings.json"));
        _flow = new DesktopAuthFlow(
            _clients, _vault, _settings, _browser,
            NullLogger<DesktopAuthFlow>.Instance, _clock);
    }

    public void Dispose()
    {
        _flow.Dispose();
        _scratch.Delete(recursive: true);
    }

    [Fact]
    public void Start_opens_the_authorize_url_with_the_pkce_challenge_and_saves_the_server()
    {
        _flow.StartSignIn(Server);

        Assert.Equal(SessionPhase.WaitingForBrowser, _flow.Current.Phase);
        Assert.Equal(Server, _settings.Load().ApplianceUrl);

        var opened = _browser.LastOpened;
        Assert.NotNull(opened);
        Assert.StartsWith("https://appliance.local/api/v1/desktop-auth/authorize?", opened.AbsoluteUri, StringComparison.Ordinal);
        Assert.Contains("code_challenge=", opened.Query, StringComparison.Ordinal);
        Assert.Contains("state=", opened.Query, StringComparison.Ordinal);
        Assert.Contains("redirect_uri=nodescope%3A%2F%2Fauth%2Fcallback", opened.Query, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_full_flow_signs_in_saves_the_vault_and_the_challenge_matches_the_verifier()
    {
        _flow.StartSignIn(Server);
        var (challenge, state) = AuthorizeParameters(_browser.LastOpened!);

        await _flow.HandleCallbackAsync(Callback("the-code", state), CancellationToken.None);

        Assert.Equal(SessionPhase.SignedIn, _flow.Current.Phase);
        Assert.Equal("owner@acme.test", _flow.Current.User?.Email);

        var client = _clients.Last;
        Assert.Equal("the-code", client.LastExchangedCode);
        // The server recomputes S256(verifier) and compares to the challenge from the
        // authorize URL; assert the same relation holds for what the client sent.
        var recomputed = Convert.ToBase64String(
                SHA256.HashData(Encoding.ASCII.GetBytes(client.LastVerifier!)))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        Assert.Equal(challenge, recomputed);

        Assert.Equal(new VaultEntry(Server, "session-token-1"), _vault.Entry);
        Assert.Equal("session-token-1", client.LastBearerToken); // users/me with the new token
    }

    [Fact]
    public async Task A_callback_with_the_wrong_state_is_rejected_without_an_exchange()
    {
        _flow.StartSignIn(Server);

        await _flow.HandleCallbackAsync(Callback("the-code", "not-our-state"), CancellationToken.None);

        Assert.Equal(SessionPhase.SignedOut, _flow.Current.Phase);
        Assert.NotNull(_flow.Current.Error);
        Assert.Null(_clients.Last.LastExchangedCode);
        Assert.Null(_vault.Entry);
    }

    [Fact]
    public async Task A_callback_after_the_pending_window_expires_is_rejected()
    {
        _flow.StartSignIn(Server);
        var (_, state) = AuthorizeParameters(_browser.LastOpened!);

        _clock.Now += TimeSpan.FromMinutes(11);
        await _flow.HandleCallbackAsync(Callback("the-code", state), CancellationToken.None);

        Assert.Equal(SessionPhase.SignedOut, _flow.Current.Phase);
        Assert.Null(_clients.Last.LastExchangedCode);
    }

    [Fact]
    public async Task An_exchange_rejection_surfaces_the_error_code_and_stays_signed_out()
    {
        _flow.StartSignIn(Server);
        var (_, state) = AuthorizeParameters(_browser.LastOpened!);
        _clients.Last.ExchangeFailure = new ApplianceApiException("DAUTH_003", "PKCE_VERIFICATION_FAILED", 400);

        await _flow.HandleCallbackAsync(Callback("the-code", state), CancellationToken.None);

        Assert.Equal(SessionPhase.SignedOut, _flow.Current.Phase);
        Assert.Contains("DAUTH_003", _flow.Current.Error, StringComparison.Ordinal);
        Assert.Null(_vault.Entry);
    }

    [Fact]
    public async Task Restore_with_an_empty_vault_lands_signed_out()
    {
        await _flow.RestoreAsync(CancellationToken.None);

        Assert.Equal(SessionPhase.SignedOut, _flow.Current.Phase);
        Assert.Empty(_clients.Created);
    }

    [Fact]
    public async Task Restore_resumes_the_vaulted_session()
    {
        _vault.Entry = new VaultEntry(Server, "vaulted-token");

        await _flow.RestoreAsync(CancellationToken.None);

        Assert.Equal(SessionPhase.SignedIn, _flow.Current.Phase);
        Assert.Equal("vaulted-token", _clients.Last.LastBearerToken);
        Assert.NotNull(_vault.Entry); // still vaulted
    }

    [Fact]
    public async Task Restore_clears_the_vault_when_the_appliance_rejects_the_token()
    {
        _vault.Entry = new VaultEntry(Server, "expired-token");

        await _flow.RestoreAsync(CancellationToken.None);
        _clients.Last.CurrentUserFailure = new ApplianceApiException("AUTH_002", "INVALID_SESSION", 401);
        _vault.Entry = new VaultEntry(Server, "expired-token");
        await _flow.RestoreAsync(CancellationToken.None);

        Assert.Equal(SessionPhase.SignedOut, _flow.Current.Phase);
        Assert.Null(_vault.Entry);
        Assert.NotNull(_flow.Current.Error);
    }

    [Fact]
    public async Task Restore_keeps_the_vault_when_the_appliance_is_unreachable()
    {
        _vault.Entry = new VaultEntry(Server, "vaulted-token");
        await _flow.RestoreAsync(CancellationToken.None); // creates the client (succeeds)

        // Same server URL, so the flow reuses the client - now scripted to fail transport.
        _clients.Last.CurrentUserFailure = new HttpRequestException("connection refused");
        await _flow.RestoreAsync(CancellationToken.None);

        Assert.Equal(SessionPhase.Unreachable, _flow.Current.Phase);
        Assert.NotNull(_vault.Entry);
        Assert.Contains("appliance.local", _flow.Current.Error, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Sign_out_revokes_clears_the_vault_and_lands_signed_out()
    {
        _vault.Entry = new VaultEntry(Server, "vaulted-token");
        await _flow.RestoreAsync(CancellationToken.None);

        await _flow.SignOutAsync(CancellationToken.None);

        Assert.Equal(SessionPhase.SignedOut, _flow.Current.Phase);
        Assert.Equal("vaulted-token", _clients.Last.RevokedToken);
        Assert.Null(_vault.Entry);
    }

    [Fact]
    public void Cancel_returns_to_signed_out_and_invalidates_the_pending_state()
    {
        _flow.StartSignIn(Server);
        _flow.CancelSignIn();

        Assert.Equal(SessionPhase.SignedOut, _flow.Current.Phase);
    }

    private static Uri Callback(string code, string state) =>
        new($"nodescope://auth/callback?code={Uri.EscapeDataString(code)}&state={Uri.EscapeDataString(state)}");

    private static (string Challenge, string State) AuthorizeParameters(Uri authorizeUrl)
    {
        string? challenge = null;
        string? state = null;
        foreach (var pair in authorizeUrl.Query.TrimStart('?').Split('&'))
        {
            var parts = pair.Split('=', 2);
            if (parts[0] == "code_challenge")
            {
                challenge = Uri.UnescapeDataString(parts[1]);
            }
            else if (parts[0] == "state")
            {
                state = Uri.UnescapeDataString(parts[1]);
            }
        }

        Assert.NotNull(challenge);
        Assert.NotNull(state);
        return (challenge, state);
    }
}
