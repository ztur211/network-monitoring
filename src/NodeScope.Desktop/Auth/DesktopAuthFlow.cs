using Microsoft.Extensions.Logging;
using NodeScope.Desktop.Api;

namespace NodeScope.Desktop.Auth;

internal enum SessionPhase
{
    SignedOut,

    /// <summary>The credential post (sign-in or sign-up) is in flight.</summary>
    SigningIn,

    /// <summary>The session is valid, but the account does not belong to an organization yet.</summary>
    NeedsOrganization,

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
    /// The live client and Bearer credential while <see cref="Current"/> is
    /// <see cref="SessionPhase.SignedIn"/> or <see cref="SessionPhase.NeedsOrganization"/>;
    /// null otherwise. View models call the API through this instead of re-reading the
    /// vault per request.
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
            Publish(await ResolveOrganizationAsync(
                client, entry.ServerUrl, user, entry.Token, cancellationToken));
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
            Publish(await ResolveOrganizationAsync(
                client, serverUrl, user, token, cancellationToken));
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
    /// Rechecks membership after the native access screen redeems an invitation. The
    /// existing token and user stay in place; no credential round trip is needed.
    /// </summary>
    public async Task RefreshOrganizationAsync(CancellationToken cancellationToken)
    {
        if (Session is not { } session
            || Current is not { User: { } user, ServerUrl: { } serverUrl }
            || Current.Phase is not (SessionPhase.NeedsOrganization or SessionPhase.SignedIn))
        {
            return;
        }

        Publish(await ResolveOrganizationAsync(
            session.Client, serverUrl, user, session.Token, cancellationToken));
    }

    private static async Task<SessionSnapshot> ResolveOrganizationAsync(
        IApplianceClient client,
        Uri serverUrl,
        CurrentUser user,
        string token,
        CancellationToken cancellationToken)
    {
        try
        {
            _ = await client.GetAccessSummaryAsync(token, cancellationToken);
            return new SessionSnapshot(SessionPhase.SignedIn, serverUrl, user, null);
        }
        catch (ApplianceApiException failure) when (failure.Code == "ORG_002")
        {
            return new SessionSnapshot(SessionPhase.NeedsOrganization, serverUrl, user, null);
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
        if (snapshot.Phase is not (SessionPhase.SignedIn or SessionPhase.NeedsOrganization))
        {
            Session = null; // authenticated phases are the only ones that own a live session
        }

        Current = snapshot;
        StateChanged?.Invoke(this, EventArgs.Empty);
    }
}
