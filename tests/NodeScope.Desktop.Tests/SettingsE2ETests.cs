using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Auth;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// The settings surface live: profile rename round-trip, enrollment-code mint, and
/// the full SNMP walk (V3 credential with key material → profile with an entry →
/// assign to a seeded device → clear → delete both) - the exact path the retired
/// web client could not exercise (its form had no V3 keys and raw-UUID assignment).
/// Geocoding is deliberately NOT exercised: it is the one WAN hop (Nominatim), the
/// same exclusion the contract suite records.
/// </summary>
/// <remarks>
/// Env-gated like the other live E2Es:
/// <c>NODESCOPE_DESKTOP_SETTINGS_E2E_BASE_URL=http://localhost:8080</c> against the
/// appliance stack + demo seed.
/// </remarks>
public sealed class SettingsE2ETests : IDisposable
{
    private readonly DirectoryInfo _scratch = Directory.CreateTempSubdirectory("nodescope-settings-e2e-");

    public void Dispose() => _scratch.Delete(recursive: true);

    [Fact]
    public async Task Profile_agents_and_snmp_walk_their_flows_against_the_live_appliance()
    {
        if (OperatingSystem.IsWindows())
        {
            Assert.Skip("the E2E drives the Linux dev-loop vault; Windows runs use DPAPI");
            return;
        }

        var configured = Environment.GetEnvironmentVariable("NODESCOPE_DESKTOP_SETTINGS_E2E_BASE_URL");
        Assert.SkipWhen(string.IsNullOrEmpty(configured),
            "set NODESCOPE_DESKTOP_SETTINGS_E2E_BASE_URL (appliance stack + demo seed) to run");

        var server = new Uri(configured);
        var email = Environment.GetEnvironmentVariable("NODESCOPE_DESKTOP_SETTINGS_E2E_EMAIL") ?? "owner@acme.test";
        var password = Environment.GetEnvironmentVariable("NODESCOPE_DESKTOP_SETTINGS_E2E_PASSWORD") ?? "devpassword123";

        var vault = new PlainFileTokenVault(Path.Combine(_scratch.FullName, "vault.json"));
        var settingsStore = new SettingsStore(Path.Combine(_scratch.FullName, "settings.json"));
        using var browser = new SignInBrowser(server);
        using var factory = new ApplianceClientFactory();
        using var flow = new DesktopAuthFlow(
            factory, vault, settingsStore, browser, NullLogger<DesktopAuthFlow>.Instance);

        await browser.SignInAsync(email, password);
        flow.StartSignIn(server);
        await flow.HandleCallbackAsync(await browser.CompleteAuthorizeAsync(), CancellationToken.None);
        Assert.Equal(SessionPhase.SignedIn, flow.Current.Phase);
        var session = flow.Session!;
        var user = flow.Current.User!;

        using var settings = new SettingsViewModel(session, user, settingsStore, NullLogger.Instance);
        await settings.Initialization;
        Assert.True(settings.CanManage, "the demo owner should manage agents and SNMP");
        Assert.NotEmpty(settings.DataSources);

        var marker = $"E2E-{Guid.NewGuid():N}";
        string? credentialId = null;
        string? profileId = null;
        string? assignedDeviceId = null;
        try
        {
            // Profile rename round-trip: change it, verify the server echo, change it back.
            var originalName = settings.ProfileName;
            settings.ProfileName = marker;
            await settings.SaveProfileCommand.ExecuteAsync(null);
            Assert.Equal("Saved.", settings.ProfileStatus);
            Assert.Equal(marker, settings.ProfileName);

            settings.ProfileName = originalName;
            await settings.SaveProfileCommand.ExecuteAsync(null);
            Assert.Equal("Saved.", settings.ProfileStatus);

            // Enrollment code mints and shapes the install command.
            await settings.GenerateEnrollmentCodeCommand.ExecuteAsync(null);
            Assert.Null(settings.AgentsError);
            Assert.False(string.IsNullOrEmpty(settings.EnrollmentCode));
            Assert.Contains("agent/install.sh", settings.InstallCommand, StringComparison.Ordinal);

            // V3 AUTH_PRIV credential with full key material - the path the web UI lacked.
            settings.CredentialName = marker;
            settings.CredentialIsV3 = true;
            settings.CredentialSecurityLevel = "AUTH_PRIV";
            settings.CredentialSecurityName = "e2e-monitor";
            settings.CredentialAuthProtocol = "SHA256";
            settings.CredentialAuthKey = "e2e-auth-key-123";
            settings.CredentialPrivProtocol = "AES256";
            settings.CredentialPrivKey = "e2e-priv-key-123";
            await settings.CreateCredentialCommand.ExecuteAsync(null);
            Assert.Null(settings.SnmpError);
            var credential = settings.Credentials.Single(row => row.Credential.Name == marker).Credential;
            credentialId = credential.Id;
            Assert.True(credential.HasAuthKey, "the server should confirm the auth key was stored");
            Assert.True(credential.HasPrivKey, "the server should confirm the priv key was stored");
            Assert.Equal("SHA256", credential.AuthProtocol);

            // Profile with one entry.
            settings.OidProfileName = marker;
            settings.AddOidEntryCommand.Execute(null);
            settings.OidEntries[0].Oid = "1.3.6.1.2.1.1.3.0";
            settings.OidEntries[0].Metric = "uptime";
            await settings.CreateOidProfileCommand.ExecuteAsync(null);
            Assert.Null(settings.SnmpError);
            profileId = settings.Profiles.Single(profile => profile.Name == marker).Id;

            // Assign both to a seeded device, then clear - observable via the result line.
            Assert.True(settings.AssignToDevice);
            Assert.NotNull(settings.AssignTarget);
            assignedDeviceId = settings.AssignTarget!.Id;
            settings.AssignCredential = settings.AssignCredentials.Single(option => option.Id == credentialId);
            settings.AssignProfile = settings.AssignProfiles.Single(option => option.Id == profileId);
            await settings.AssignCommand.ExecuteAsync(null);
            Assert.Equal("Assigned.", settings.AssignResult);

            // Deleting an assigned credential must refuse with the SNMP_003 copy.
            var credentialRow = settings.Credentials.Single(row => row.Credential.Id == credentialId);
            await settings.DeleteCredentialCommand.ExecuteAsync(credentialRow);
            await settings.DeleteCredentialCommand.ExecuteAsync(credentialRow);
            Assert.Contains("unassign it first", settings.SnmpError, StringComparison.Ordinal);

            // Clear the assignment, then the deletes go through.
            settings.AssignCredential = settings.AssignCredentials.Single(option => option.Id is null);
            settings.AssignProfile = settings.AssignProfiles.Single(option => option.Id is null);
            await settings.AssignCommand.ExecuteAsync(null);
            Assert.Equal("Assignment cleared.", settings.AssignResult);

            settings.SnmpError = null;
            await settings.DeleteCredentialCommand.ExecuteAsync(credentialRow);
            await settings.DeleteCredentialCommand.ExecuteAsync(credentialRow);
            Assert.Null(settings.SnmpError);
            Assert.DoesNotContain(settings.Credentials, row => row.Credential.Id == credentialId);
            credentialId = null;

            await session.Client.DeleteOidProfileAsync(session.Token, profileId, CancellationToken.None);
            profileId = null;
        }
        finally
        {
            // Never leave E2E residue: clear the assignment and delete stragglers.
            if (assignedDeviceId is not null && (credentialId is not null || profileId is not null))
            {
                await session.Client.AssignSnmpAsync(
                    session.Token,
                    new SnmpAssignment("device", assignedDeviceId, null, null),
                    CancellationToken.None);
            }

            if (credentialId is not null)
            {
                await session.Client.DeleteSnmpCredentialAsync(session.Token, credentialId, CancellationToken.None);
            }

            if (profileId is not null)
            {
                await session.Client.DeleteOidProfileAsync(session.Token, profileId, CancellationToken.None);
            }
        }
    }
}
