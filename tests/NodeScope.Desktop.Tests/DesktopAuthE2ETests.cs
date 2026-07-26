using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Auth;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// The real client code against the real C# host, nothing faked: native sign-up creates
/// the account in place, the org-less session is vaulted and works as a live Bearer credential,
/// rejected credentials surface the server's message, and sign-out revokes server-side.
/// </summary>
/// <remarks>
/// Env-gated like the agent's snmpd matrix: start the test stack + host
/// (<c>scripts/run-csharp-host.sh</c>) and run with
/// <c>NODESCOPE_DESKTOP_E2E_BASE_URL=http://127.0.0.1:5199</c>; reported as skipped otherwise.
/// </remarks>
[Collection(LiveApplianceSuite.Name)]
public sealed class DesktopAuthE2ETests : IDisposable
{
    private readonly DirectoryInfo _scratch = Directory.CreateTempSubdirectory("nodescope-e2e-");

    public void Dispose() => _scratch.Delete(recursive: true);

    [Fact]
    public async Task Native_sign_up_signs_in_vaults_the_token_and_sign_out_kills_the_session()
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
        using var factory = new ApplianceClientFactory();
        using var flow = new DesktopAuthFlow(factory, vault, settings, NullLogger<DesktopAuthFlow>.Instance);

        var email = $"desktop-e2e-{Guid.NewGuid():N}@example.com";
        await flow.SignUpAsync(server, "Desktop E2E", email, "Password123!", CancellationToken.None);

        Assert.Equal(SessionPhase.NeedsOrganization, flow.Current.Phase);
        Assert.Equal(email, flow.Current.User?.Email);
        Assert.Equal(server, settings.Load().ApplianceUrl);
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

        // Wrong credentials surface the mapped human copy and leave nothing vaulted.
        await flow.SignInAsync(server, email, "not-the-password", CancellationToken.None);
        Assert.Equal(SessionPhase.SignedOut, flow.Current.Phase);
        Assert.Equal("Invalid email or password.", flow.Current.Error);
        Assert.Null(vault.Load());
    }
}
