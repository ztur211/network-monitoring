using Microsoft.Extensions.Logging;
using NodeScope.Desktop.Api;

namespace NodeScope.Desktop.Auth;

internal enum SessionPhase
{
    SignedOut,

    /// <summary>The system browser is open; we are waiting for the nodescope:// callback.</summary>
    WaitingForBrowser,

    /// <summary>Callback received; the one-time code is being exchanged.</summary>
    Exchanging,

    SignedIn,

    /// <summary>A stored session exists but the appliance did not answer; retry keeps it.</summary>
    Unreachable,
}

/// <summary>What the UI renders; a new snapshot is published on every transition.</summary>
internal sealed record SessionSnapshot(
    SessionPhase Phase,
    Uri? ServerUrl,
    CurrentUser? User,
    string? Error)
{
    public static SessionSnapshot SignedOut(string? error = null) =>
        new(SessionPhase.SignedOut, null, null, error);
}

/// <summary>
/// The desktop side of Decision 17's PKCE flow. Owns the session lifecycle:
/// restore-from-vault at startup, browser sign-in, callback exchange, sign-out.
/// </summary>
/// <remarks>
/// UI-thread affine by design: every entry point is called from the Avalonia dispatcher
/// (commands and dispatched scheme activations), so state needs no locking. Failures never
/// throw out of the flow - they become snapshots with an <c>Error</c>, because every error
/// here ends in the same place: the sign-in screen with a message.
/// </remarks>
internal sealed class DesktopAuthFlow(
    IApplianceClientFactory clients,
    ITokenVault vault,
    SettingsStore settings,
    IBrowserLauncher browser,
    ILogger<DesktopAuthFlow> logger,
    TimeProvider? timeProvider = null) : IDisposable
{
    /// <summary>
    /// How long a started sign-in stays valid. Generous on purpose: the 120s server-side
    /// code TTL starts at the redirect, but the user may sit on the web login form first.
    /// </summary>
    private static readonly TimeSpan PendingTtl = TimeSpan.FromMinutes(10);

    private readonly TimeProvider _time = timeProvider ?? TimeProvider.System;
    private IApplianceClient? _client;
    private PendingSignIn? _pending;

    public SessionSnapshot Current { get; private set; } = SessionSnapshot.SignedOut();

    public event EventHandler? StateChanged;

    public void Dispose() => _client?.Dispose();

    /// <summary>Startup path: resume the vaulted session if the appliance confirms it.</summary>
    public async Task RestoreAsync(CancellationToken cancellationToken)
    {
        var entry = vault.Load();
        if (entry is null)
        {
            Publish(SessionSnapshot.SignedOut());
            return;
        }

        var client = UseClient(entry.ServerUrl);
        try
        {
            var user = await client.GetCurrentUserAsync(entry.Token, cancellationToken);
            AuthLog.SessionRestored(logger, user.Email, entry.ServerUrl);
            Publish(new SessionSnapshot(SessionPhase.SignedIn, entry.ServerUrl, user, null));
        }
        catch (ApplianceApiException failure) when (failure.Status == 401)
        {
            // The appliance answered and rejected the token: the session is gone for real.
            // The server URL rides along so the sign-in form is prefilled.
            AuthLog.StoredSessionRejected(logger, entry.ServerUrl);
            vault.Clear();
            Publish(new SessionSnapshot(
                SessionPhase.SignedOut, entry.ServerUrl, null, "Your session has expired - sign in again."));
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException or TaskCanceledException)
        {
            // No verdict from the appliance; keep the vault and offer retry (local-first:
            // an unreachable server is an outage to ride out, not a reason to log out).
            AuthLog.RestoreUnreachable(logger, entry.ServerUrl, failure.Message);
            Publish(new SessionSnapshot(
                SessionPhase.Unreachable, entry.ServerUrl, null,
                $"Could not reach {entry.ServerUrl}: {failure.Message}"));
        }
    }

    /// <summary>Kicks off the browser sign-in against <paramref name="serverUrl"/>.</summary>
    public void StartSignIn(Uri serverUrl)
    {
        if (Current.Phase == SessionPhase.Exchanging)
        {
            return; // an exchange is in flight; let it finish or fail first
        }

        settings.Save(new DesktopSettings(serverUrl));
        var client = UseClient(serverUrl);

        var pkce = Pkce.NewPair();
        _pending = new PendingSignIn(client, pkce, Pkce.NewState(), _time.GetUtcNow() + PendingTtl);

        var authorizeUrl = new Uri(client.BaseUrl,
            "api/v1/desktop-auth/authorize"
            + $"?code_challenge={Uri.EscapeDataString(pkce.Challenge)}"
            + $"&state={Uri.EscapeDataString(_pending.State)}"
            + $"&redirect_uri={Uri.EscapeDataString(DesktopCallback.RedirectUri)}");

        AuthLog.SignInStarted(logger, serverUrl);
        browser.Open(authorizeUrl);
        Publish(new SessionSnapshot(SessionPhase.WaitingForBrowser, serverUrl, null, null));
    }

    /// <summary>Abandons a browser sign-in that is still pending.</summary>
    public void CancelSignIn()
    {
        if (Current.Phase != SessionPhase.WaitingForBrowser)
        {
            return;
        }

        _pending = null;
        Publish(SessionSnapshot.SignedOut());
    }

    /// <summary>Handles a <c>nodescope://auth/callback</c> activation from the OS.</summary>
    public async Task HandleCallbackAsync(Uri callback, CancellationToken cancellationToken)
    {
        if (Current.Phase == SessionPhase.Exchanging)
        {
            AuthLog.CallbackRejected(logger, "an exchange is already in flight");
            return;
        }

        var parsed = DesktopCallback.Parse(callback);
        if (parsed is null)
        {
            AuthLog.CallbackRejected(logger, "the URI is not the auth callback shape");
            return;
        }

        var pending = _pending;
        if (pending is null
            || !string.Equals(pending.State, parsed.State, StringComparison.Ordinal)
            || pending.ExpiresAt <= _time.GetUtcNow())
        {
            // Wrong or stale state is the CSRF case: an activation we did not start.
            AuthLog.CallbackRejected(logger, "no matching pending sign-in (state mismatch or expired)");
            Publish(SessionSnapshot.SignedOut("The sign-in could not be verified - start it again from here."));
            return;
        }

        _pending = null;
        Publish(new SessionSnapshot(SessionPhase.Exchanging, pending.Client.BaseUrl, null, null));

        try
        {
            var token = await pending.Client.ExchangeDesktopCodeAsync(
                parsed.Code, pending.Pkce.Verifier, cancellationToken);
            vault.Save(new VaultEntry(pending.Client.BaseUrl, token));

            var user = await pending.Client.GetCurrentUserAsync(token, cancellationToken);
            AuthLog.SignedIn(logger, user.Email, pending.Client.BaseUrl);
            Publish(new SessionSnapshot(SessionPhase.SignedIn, pending.Client.BaseUrl, user, null));
        }
        catch (ApplianceApiException failure)
        {
            AuthLog.ExchangeFailed(logger, failure.Code, failure.Message);
            Publish(SessionSnapshot.SignedOut($"Sign-in failed ({failure.Code}): {failure.Message}"));
        }
        catch (Exception failure) when (failure is HttpRequestException or TaskCanceledException)
        {
            AuthLog.ExchangeFailed(logger, "TRANSPORT", failure.Message);
            Publish(SessionSnapshot.SignedOut($"Could not reach the appliance: {failure.Message}"));
        }
    }

    /// <summary>Revokes the session server-side (best effort) and forgets it locally.</summary>
    public async Task SignOutAsync(CancellationToken cancellationToken)
    {
        var entry = vault.Load();
        if (entry is not null && _client is not null)
        {
            try
            {
                await _client.RevokeAsync(entry.Token, cancellationToken);
            }
            catch (Exception failure) when (
                failure is ApplianceApiException or HttpRequestException or TaskCanceledException)
            {
                // The local sign-out must not hinge on the server being up; the session
                // row still dies at its 30-day expiry.
                AuthLog.RevokeFailed(logger, failure.Message);
            }
        }

        vault.Clear();
        AuthLog.SignedOut(logger);
        // Keep the server URL visible so signing back in is one click, not a retype.
        Publish(new SessionSnapshot(SessionPhase.SignedOut, Current.ServerUrl, null, null));
    }

    private IApplianceClient UseClient(Uri serverUrl)
    {
        if (_client is null || _client.BaseUrl != serverUrl)
        {
            _client?.Dispose();
            _client = clients.Create(serverUrl);
        }

        return _client;
    }

    private void Publish(SessionSnapshot snapshot)
    {
        Current = snapshot;
        StateChanged?.Invoke(this, EventArgs.Empty);
    }

    private sealed record PendingSignIn(
        IApplianceClient Client, PkcePair Pkce, string State, DateTimeOffset ExpiresAt);
}
