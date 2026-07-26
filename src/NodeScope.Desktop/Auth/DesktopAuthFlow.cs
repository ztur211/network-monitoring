using Microsoft.Extensions.Logging;
using NodeScope.Desktop.Api;

namespace NodeScope.Desktop.Auth;

internal enum SessionPhase
{
    SignedOut,

    /// <summary>The credential post (sign-in or sign-up) is in flight.</summary>
    SigningIn,

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
/// The native auth flow. Owns the session lifecycle: restore-from-vault at startup,
/// credential sign-in/sign-up straight against the appliance, sign-out.
/// </summary>
/// <remarks>
/// UI-thread affine by design: every entry point is called from the Avalonia dispatcher,
/// so state needs no locking. Failures never throw out of the flow - they become
/// snapshots with an <c>Error</c>, because every error here ends in the same place:
/// the sign-in screen with a message.
/// </remarks>
internal sealed class DesktopAuthFlow(
    IApplianceClientFactory clients,
    ITokenVault vault,
    SettingsStore settings,
    ILogger<DesktopAuthFlow> logger) : IDisposable
{
    private IApplianceClient? _client;

    public SessionSnapshot Current { get; private set; } = SessionSnapshot.SignedOut();

    /// <summary>
    /// The live client + Bearer credential while <see cref="Current"/> is SignedIn; null
    /// otherwise. Feature view models (map, inventory, …) call the API through this
    /// instead of re-reading the vault per request.
    /// </summary>
    public ApplianceSession? Session { get; private set; }

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
            Session = new ApplianceSession(client, entry.Token);
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

    /// <summary>Signs in with the credentials, in place - no browser leaves the app.</summary>
    public Task SignInAsync(Uri serverUrl, string email, string password, CancellationToken cancellationToken) =>
        AuthenticateAsync(
            serverUrl,
            client => client.SignInAsync(email, password, cancellationToken),
            cancellationToken);

    /// <summary>Creates the account and signs into its first session.</summary>
    public Task SignUpAsync(
        Uri serverUrl, string name, string email, string password, CancellationToken cancellationToken) =>
        AuthenticateAsync(
            serverUrl,
            client => client.SignUpAsync(name, email, password, cancellationToken),
            cancellationToken);

    /// <summary>Revokes the session server-side (best effort) and forgets it locally.</summary>
    public async Task SignOutAsync(CancellationToken cancellationToken)
    {
        var entry = vault.Load();
        if (entry is not null && _client is not null)
        {
            try
            {
                await _client.SignOutAsync(entry.Token, cancellationToken);
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

    private async Task AuthenticateAsync(
        Uri serverUrl,
        Func<IApplianceClient, Task<string>> credential,
        CancellationToken cancellationToken)
    {
        if (Current.Phase == SessionPhase.SigningIn)
        {
            return; // a credential post is in flight; let it finish or fail first
        }

        // Read-modify-write: the settings file also carries the theme choice.
        settings.Save(settings.Load() with { ApplianceUrl = serverUrl });
        var client = UseClient(serverUrl);

        AuthLog.SignInStarted(logger, serverUrl);
        Publish(new SessionSnapshot(SessionPhase.SigningIn, serverUrl, null, null));

        try
        {
            var token = await credential(client);
            vault.Save(new VaultEntry(serverUrl, token));

            var user = await client.GetCurrentUserAsync(token, cancellationToken);
            AuthLog.SignedIn(logger, user.Email, serverUrl);
            Session = new ApplianceSession(client, token);
            Publish(new SessionSnapshot(SessionPhase.SignedIn, serverUrl, user, null));
        }
        catch (ApplianceApiException failure)
        {
            AuthLog.SignInFailed(logger, failure.Code, failure.Message);
            Publish(new SessionSnapshot(SessionPhase.SignedOut, serverUrl, null, CredentialErrorCopy(failure)));
        }
        catch (Exception failure) when (failure is HttpRequestException or TaskCanceledException)
        {
            AuthLog.SignInFailed(logger, "TRANSPORT", failure.Message);
            Publish(new SessionSnapshot(
                SessionPhase.SignedOut, serverUrl, null,
                $"Could not reach the appliance: {failure.Message}"));
        }
    }

    /// <summary>
    /// The wire speaks stable codes with SCREAMING messages ("INVALID_CREDENTIALS");
    /// the form speaks sentences. Unknown codes fall back to the raw message.
    /// </summary>
    private static string CredentialErrorCopy(ApplianceApiException failure) => failure.Code switch
    {
        "AUTH_001" => "Invalid email or password.",
        "AUTH_005" => "An account with this email already exists - sign in instead.",
        "GEN_001" => "Check the email address and password (8 characters minimum).",
        "GEN_004" => "Too many attempts - wait a few minutes and try again.",
        _ => failure.Message,
    };

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
        if (snapshot.Phase != SessionPhase.SignedIn)
        {
            Session = null; // invariant: a session exists exactly while signed in
        }

        Current = snapshot;
        StateChanged?.Invoke(this, EventArgs.Empty);
    }
}
