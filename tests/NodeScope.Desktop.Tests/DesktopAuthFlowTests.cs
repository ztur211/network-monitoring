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
    private readonly InMemoryTokenVault _vault = new();
    private readonly SettingsStore _settings;
    private readonly DesktopAuthFlow _flow;

    public DesktopAuthFlowTests()
    {
        _settings = new SettingsStore(Path.Combine(_scratch.FullName, "settings.json"));
        _flow = new DesktopAuthFlow(_clients, _vault, _settings, NullLogger<DesktopAuthFlow>.Instance);
    }

    public void Dispose()
    {
        _flow.Dispose();
        _scratch.Delete(recursive: true);
    }

    [Fact]
    public async Task Sign_in_posts_the_credentials_saves_the_server_and_vaults_the_token()
    {
        await _flow.SignInAsync(Server, "owner@acme.test", "devpassword123", CancellationToken.None);

        Assert.Equal(SessionPhase.SignedIn, _flow.Current.Phase);
        Assert.Equal("owner@acme.test", _flow.Current.User?.Email);
        Assert.Equal(Server, _settings.Load().ApplianceUrl);

        var client = _clients.Last;
        Assert.Equal(("owner@acme.test", "devpassword123"), client.LastSignIn);
        Assert.Equal(new VaultEntry(Server, "session-token-1"), _vault.Entry);
        Assert.Equal("session-token-1", client.LastBearerToken); // users/me with the new token
        Assert.Equal("session-token-1", _flow.Session?.Token);
    }

    [Fact]
    public async Task Sign_up_creates_the_account_and_signs_into_its_first_session()
    {
        await _flow.SignUpAsync(Server, "Owner", "owner@acme.test", "devpassword123", CancellationToken.None);

        Assert.Equal(SessionPhase.SignedIn, _flow.Current.Phase);
        Assert.Equal(("Owner", "owner@acme.test", "devpassword123"), _clients.Last.LastSignUp);
        Assert.Equal(new VaultEntry(Server, "session-token-1"), _vault.Entry);
    }

    [Fact]
    public async Task An_orgless_account_keeps_its_session_and_lands_at_the_access_gate()
    {
        _clients.Configure = client =>
        {
            client.UserToReturn = new CurrentUser(
                "user-2", "teammate@acme.test", "New Teammate");
            client.AccessFailure = new ApplianceApiException("ORG_002", "NOT_AN_ORG_MEMBER", 403);
        };

        await _flow.SignUpAsync(
            Server, "New Teammate", "teammate@acme.test", "devpassword123", CancellationToken.None);

        Assert.Equal(SessionPhase.NeedsOrganization, _flow.Current.Phase);
        Assert.Equal("teammate@acme.test", _flow.Current.User?.Email);
        Assert.Equal(new VaultEntry(Server, "session-token-1"), _vault.Entry);
        Assert.Equal("session-token-1", _flow.Session?.Token);
    }

    [Fact]
    public async Task Refresh_after_invitation_acceptance_enters_the_workspace_without_reauthenticating()
    {
        _clients.Configure = client =>
            client.AccessFailure = new ApplianceApiException("ORG_002", "NOT_AN_ORG_MEMBER", 403);
        await _flow.SignInAsync(
            Server, "teammate@acme.test", "devpassword123", CancellationToken.None);
        var client = _clients.Last;
        Assert.Equal(SessionPhase.NeedsOrganization, _flow.Current.Phase);

        client.AccessFailure = null;
        await _flow.RefreshOrganizationAsync(CancellationToken.None);

        Assert.Equal(SessionPhase.SignedIn, _flow.Current.Phase);
        Assert.Equal(1, client.CredentialPosts);
        Assert.Equal("session-token-1", _flow.Session?.Token);
    }

    [Fact]
    public async Task Rejected_credentials_surface_the_server_message_and_stay_signed_out()
    {
        _clients.Configure = client =>
            client.SignInFailure = new ApplianceApiException("AUTH_001", "INVALID_CREDENTIALS", 401);

        await _flow.SignInAsync(Server, "owner@acme.test", "wrong", CancellationToken.None);

        Assert.Equal(SessionPhase.SignedOut, _flow.Current.Phase);
        Assert.Equal("Invalid email or password.", _flow.Current.Error);
        Assert.Null(_vault.Entry);
        Assert.Null(_flow.Session);
    }

    [Fact]
    public async Task A_transport_failure_reads_as_could_not_reach_the_appliance()
    {
        _clients.Configure = client =>
            client.SignInFailure = new HttpRequestException("connection refused");

        await _flow.SignInAsync(Server, "owner@acme.test", "devpassword123", CancellationToken.None);

        Assert.Equal(SessionPhase.SignedOut, _flow.Current.Phase);
        Assert.Contains("Could not reach the appliance", _flow.Current.Error, StringComparison.Ordinal);
        Assert.Null(_vault.Entry);
    }

    [Fact]
    public async Task A_second_submit_is_ignored_while_the_first_is_in_flight()
    {
        var gate = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        _clients.Configure = client => client.SignInGate = gate;

        var first = _flow.SignInAsync(Server, "owner@acme.test", "devpassword123", CancellationToken.None);
        Assert.Equal(SessionPhase.SigningIn, _flow.Current.Phase);

        await _flow.SignInAsync(Server, "owner@acme.test", "devpassword123", CancellationToken.None);
        Assert.Equal(1, _clients.Last.CredentialPosts);

        gate.SetResult("session-token-1");
        await first;
        Assert.Equal(SessionPhase.SignedIn, _flow.Current.Phase);
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
    public async Task Restore_resumes_an_orgless_account_at_the_access_gate()
    {
        _vault.Entry = new VaultEntry(Server, "vaulted-token");
        _clients.Configure = client =>
            client.AccessFailure = new ApplianceApiException("ORG_002", "NOT_AN_ORG_MEMBER", 403);

        await _flow.RestoreAsync(CancellationToken.None);

        Assert.Equal(SessionPhase.NeedsOrganization, _flow.Current.Phase);
        Assert.Equal("vaulted-token", _flow.Session?.Token);
        Assert.NotNull(_vault.Entry);
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
        Assert.Equal("vaulted-token", _clients.Last.SignedOutToken);
        Assert.Null(_vault.Entry);
    }
}
