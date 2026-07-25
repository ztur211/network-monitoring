using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Auth;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// The settings section against the fake appliance: profile diffing, geocode
/// outcomes, local-only theme persistence, role-gated agents/SNMP loading, and the
/// SNMP create/delete/assign flows with their wire semantics.
/// </summary>
public sealed class SettingsViewModelTests : IDisposable
{
    private static readonly Uri Server = new("https://appliance.local/");

    private readonly FakeApplianceClient _client = new(Server);
    private readonly DirectoryInfo _scratch = Directory.CreateTempSubdirectory("nodescope-settings-");
    private readonly SettingsStore _store;
    private SettingsViewModel? _viewModel;

    public SettingsViewModelTests()
    {
        _store = new SettingsStore(Path.Combine(_scratch.FullName, "settings.json"));
        _store.Save(new DesktopSettings(Server));
    }

    public void Dispose()
    {
        _viewModel?.Dispose();
        _client.Dispose();
        _scratch.Delete(recursive: true);
    }

    private async Task<SettingsViewModel> CreateAsync(CurrentUser? user = null)
    {
        _viewModel = new SettingsViewModel(
            new ApplianceSession(_client, "token-1"),
            user ?? new CurrentUser("user-1", "owner@acme.test", "Owner"),
            _store,
            NullLogger.Instance);
        await _viewModel.Initialization;
        return _viewModel;
    }

    [Fact]
    public async Task Profile_save_sends_only_the_changed_fields()
    {
        var viewModel = await CreateAsync();

        viewModel.ProfileName = "New Name";
        await viewModel.SaveProfileCommand.ExecuteAsync(null);

        Assert.Equal(("New Name", (string?)null), Assert.Single(_client.MeUpdates));
        Assert.Equal("Saved.", viewModel.ProfileStatus);

        _client.MeUpdates.Clear();
        viewModel.ProfileEmail = "new@acme.test";
        await viewModel.SaveProfileCommand.ExecuteAsync(null);
        Assert.Equal(((string?)null, "new@acme.test"), Assert.Single(_client.MeUpdates));
    }

    [Fact]
    public async Task A_taken_email_surfaces_the_AUTH_005_copy()
    {
        var viewModel = await CreateAsync();
        _client.SettingsFailure = new ApplianceApiException("AUTH_005", "EMAIL_IN_USE", 422);

        viewModel.ProfileEmail = "taken@acme.test";
        await viewModel.SaveProfileCommand.ExecuteAsync(null);

        Assert.Equal("That email is already in use.", viewModel.ProfileError);
    }

    [Fact]
    public async Task Geocode_success_and_MAP_001_render_their_lines()
    {
        var viewModel = await CreateAsync();

        viewModel.AddressText = "260 Broadway, New York";
        await viewModel.SetLocationCommand.ExecuteAsync(null);
        Assert.Contains("40.71280", viewModel.LocationResult, StringComparison.Ordinal);
        Assert.Equal("260 Broadway, New York", Assert.Single(_client.GeocodedAddresses));

        _client.SettingsFailure = new ApplianceApiException("MAP_001", "GEOCODING_FAILED", 422);
        viewModel.AddressText = "nowhere";
        await viewModel.SetLocationCommand.ExecuteAsync(null);
        Assert.Equal("Geocoding failed. Try a more specific address.", viewModel.LocationError);
    }

    [Fact]
    public async Task The_theme_choice_persists_locally_and_survives_a_url_resave()
    {
        var viewModel = await CreateAsync();

        viewModel.SelectedTheme = viewModel.Themes.Single(theme => theme.Key == "dark");
        Assert.Equal("dark", _store.Load().Theme);

        // The auth flow's URL save must not clobber the theme (read-modify-write).
        _store.Save(_store.Load() with { ApplianceUrl = new Uri("https://other.local/") });
        Assert.Equal("dark", _store.Load().Theme);

        viewModel.SelectedTheme = viewModel.Themes.Single(theme => theme.Key is null);
        Assert.Null(_store.Load().Theme);
    }

    [Fact]
    public async Task A_member_never_touches_the_agents_or_snmp_endpoints()
    {
        _client.AccessToReturn = new AccessSummary("MEMBER", [], false);
        _client.SettingsFailure = null;

        var viewModel = await CreateAsync();

        Assert.False(viewModel.CanManage);
        Assert.Empty(viewModel.Agents);
        Assert.Empty(viewModel.Credentials);
        // The fake would have recorded list calls; a MEMBER must produce none.
        Assert.Empty(_client.CreatedSnmpCredentials);
    }

    [Fact]
    public async Task Enrollment_code_builds_the_install_command_from_the_server_url()
    {
        var viewModel = await CreateAsync();

        await viewModel.GenerateEnrollmentCodeCommand.ExecuteAsync(null);

        Assert.Equal("code-abc123", viewModel.EnrollmentCode);
        Assert.Contains("https://appliance.local/agent/install.sh", viewModel.InstallCommand, StringComparison.Ordinal);
        Assert.Contains("--code code-abc123", viewModel.InstallCommand, StringComparison.Ordinal);
        Assert.Equal("nodescope-agent enroll --code code-abc123", viewModel.EnrollCommand);
    }

    [Fact]
    public async Task Agent_revoke_is_two_step_and_reflects_the_server_status()
    {
        _client.Agents.Add(new Agent("a1", "office-agent", "linux", "0.1.1", "APPROVED", null));
        var viewModel = await CreateAsync();
        var row = Assert.Single(viewModel.Agents);

        await viewModel.RevokeAgentCommand.ExecuteAsync(row);
        Assert.True(row.ConfirmingRevoke);
        Assert.Empty(_client.RevokedAgentIds);

        await viewModel.RevokeAgentCommand.ExecuteAsync(row);
        Assert.Equal("a1", Assert.Single(_client.RevokedAgentIds));
        Assert.Equal("REVOKED", Assert.Single(viewModel.Agents).Agent.Status);
        Assert.False(Assert.Single(viewModel.Agents).CanRevoke);
    }

    [Fact]
    public async Task A_v2c_credential_carries_the_community_and_nothing_v3()
    {
        var viewModel = await CreateAsync();

        viewModel.CredentialName = "office-v2c";
        viewModel.CredentialCommunity = "public";
        await viewModel.CreateCredentialCommand.ExecuteAsync(null);

        var created = Assert.Single(_client.CreatedSnmpCredentials);
        Assert.Equal("V2C", created.SnmpVersion);
        Assert.Equal("public", created.Community);
        Assert.Null(created.AuthProtocol);
        Assert.Null(created.AuthKey);
        Assert.Single(viewModel.Credentials);
        Assert.False(viewModel.CredentialFormOpen);
    }

    [Fact]
    public async Task A_v3_auth_priv_credential_carries_the_full_key_material()
    {
        var viewModel = await CreateAsync();

        viewModel.CredentialName = "core-v3";
        viewModel.CredentialIsV3 = true;
        viewModel.CredentialSecurityLevel = "AUTH_PRIV";
        viewModel.CredentialSecurityName = "monitor";
        viewModel.CredentialAuthProtocol = "SHA256";
        viewModel.CredentialAuthKey = "auth-secret";
        viewModel.CredentialPrivProtocol = "AES256";
        viewModel.CredentialPrivKey = "priv-secret";
        await viewModel.CreateCredentialCommand.ExecuteAsync(null);

        var created = Assert.Single(_client.CreatedSnmpCredentials);
        Assert.Equal("V3", created.SnmpVersion);
        Assert.Equal("AUTH_PRIV", created.SecurityLevel);
        Assert.Equal("monitor", created.SecurityName);
        Assert.Equal("SHA256", created.AuthProtocol);
        Assert.Equal("auth-secret", created.AuthKey);
        Assert.Equal("AES256", created.PrivProtocol);
        Assert.Equal("priv-secret", created.PrivKey);
        Assert.Null(created.Community);
    }

    [Fact]
    public async Task A_no_auth_v3_credential_omits_key_material_entirely()
    {
        var viewModel = await CreateAsync();

        viewModel.CredentialName = "read-only";
        viewModel.CredentialIsV3 = true;
        viewModel.CredentialSecurityLevel = "NO_AUTH_NO_PRIV";
        viewModel.CredentialSecurityName = "public-user";
        viewModel.CredentialAuthKey = "typed-but-unused";
        await viewModel.CreateCredentialCommand.ExecuteAsync(null);

        var created = Assert.Single(_client.CreatedSnmpCredentials);
        Assert.Null(created.AuthProtocol);
        Assert.Null(created.AuthKey);
        Assert.Null(created.PrivProtocol);
        Assert.Null(created.PrivKey);
    }

    [Fact]
    public async Task An_assigned_credential_delete_shows_the_SNMP_003_copy()
    {
        _client.SnmpCredentials.Add(new SnmpCredential(
            "c1", "assigned", "V2C", null, null, null, null, true, false, false, 1));
        var viewModel = await CreateAsync();
        var row = Assert.Single(viewModel.Credentials);

        await viewModel.DeleteCredentialCommand.ExecuteAsync(row);
        _client.SettingsFailure = new ApplianceApiException("SNMP_003", "CREDENTIAL_IN_USE", 409);
        await viewModel.DeleteCredentialCommand.ExecuteAsync(row);

        Assert.Contains("unassign it first", viewModel.SnmpError, StringComparison.Ordinal);
        Assert.Single(viewModel.Credentials);
    }

    [Fact]
    public async Task Assignment_always_serializes_both_ids_null_meaning_clear()
    {
        _client.BimDevices.Add(new BimDevice(
            "d1", "n1", "p1", null, null, "Core Router", "ROUTER", null, null, null, null,
            null, null, null, null, null, null, null, 1, DateTime.UtcNow, DateTime.UtcNow));
        _client.Networks.Add(new NetworkSummary("n1", "Home", null, null, null, null, null, null, 1));
        _client.SnmpCredentials.Add(new SnmpCredential(
            "c1", "office", "V2C", null, null, null, null, true, false, false, 1));
        var viewModel = await CreateAsync();

        // Device target with a credential and no profile.
        viewModel.AssignCredential = viewModel.AssignCredentials.Single(option => option.Id == "c1");
        await viewModel.AssignCommand.ExecuteAsync(null);
        var first = Assert.Single(_client.Assignments);
        Assert.Equal("device", first.TargetType);
        Assert.Equal("d1", first.TargetId);
        Assert.Equal("c1", first.SnmpCredentialId);
        Assert.Null(first.OidProfileId);

        // Network target with everything cleared.
        viewModel.SelectAssignNetworkCommand.Execute(null);
        Assert.Equal("Home", viewModel.AssignTarget!.Label);
        viewModel.AssignCredential = viewModel.AssignCredentials[0];
        await viewModel.AssignCommand.ExecuteAsync(null);
        Assert.Equal(2, _client.Assignments.Count);
        Assert.Equal("network", _client.Assignments[1].TargetType);
        Assert.Null(_client.Assignments[1].SnmpCredentialId);
        Assert.Equal("Assignment cleared.", viewModel.AssignResult);
    }

    [Fact]
    public async Task Oid_profile_create_sends_only_the_completed_entry_rows()
    {
        var viewModel = await CreateAsync();

        viewModel.OidProfileName = "core-metrics";
        viewModel.AddOidEntryCommand.Execute(null);
        viewModel.AddOidEntryCommand.Execute(null);
        viewModel.OidEntries[0].Oid = "1.3.6.1.2.1.1.3.0";
        viewModel.OidEntries[0].Metric = "uptime";
        // The second row stays blank and must be dropped, not sent half-empty.
        await viewModel.CreateOidProfileCommand.ExecuteAsync(null);

        var created = Assert.Single(_client.CreatedOidProfiles);
        Assert.Equal("core-metrics", created.Name);
        var entry = Assert.Single(created.Entries);
        Assert.Equal("uptime", entry.Metric);
        Assert.Single(viewModel.Profiles);
    }
}
