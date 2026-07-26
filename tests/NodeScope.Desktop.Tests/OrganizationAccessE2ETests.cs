using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Auth;
using NodeScope.Desktop.ViewModels;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// First-run and teammate onboarding against an empty real database: account creation
/// stops at the native access gate, the installer credential atomically creates the
/// first organization, an OWNER issues an invite, and the invited account redeems it
/// into a MEMBER session without signing in again.
/// </summary>
/// <remarks>
/// This test needs an otherwise empty database. Point a current API host at one, then set
/// <c>NODESCOPE_DESKTOP_ORGANIZATION_E2E_BASE_URL</c> and
/// <c>NODESCOPE_DESKTOP_BOOTSTRAP_TOKEN</c>.
/// </remarks>
[Collection(LiveApplianceSuite.Name)]
public sealed class OrganizationAccessE2ETests : IDisposable
{
    private readonly DirectoryInfo _scratch =
        Directory.CreateTempSubdirectory("nodescope-organization-e2e-");

    public void Dispose() => _scratch.Delete(recursive: true);

    [Fact]
    public async Task First_owner_bootstrap_and_teammate_invitation_complete_natively()
    {
        if (OperatingSystem.IsWindows())
        {
            Assert.Skip("the E2E drives the Linux dev-loop vault; Windows runs use DPAPI");
            return;
        }

        var configured = Environment.GetEnvironmentVariable(
            "NODESCOPE_DESKTOP_ORGANIZATION_E2E_BASE_URL");
        var bootstrapToken = Environment.GetEnvironmentVariable(
            "NODESCOPE_DESKTOP_BOOTSTRAP_TOKEN");
        Assert.SkipWhen(
            string.IsNullOrEmpty(configured) || string.IsNullOrEmpty(bootstrapToken),
            "set the organization E2E URL and bootstrap token against an empty database");

        var server = new Uri(configured);
        using var factory = new ApplianceClientFactory();

        var ownerVault = new PlainFileTokenVault(
            Path.Combine(_scratch.FullName, "owner-vault.json"));
        var ownerSettings = new SettingsStore(
            Path.Combine(_scratch.FullName, "owner-settings.json"));
        using var ownerFlow = new DesktopAuthFlow(
            factory, ownerVault, ownerSettings, NullLogger<DesktopAuthFlow>.Instance);
        var ownerEmail = $"first-owner-{Guid.NewGuid():N}@bootstrap.test";
        await ownerFlow.SignUpAsync(
            server, "First Owner", ownerEmail, "Password123!", CancellationToken.None);
        Assert.Equal(SessionPhase.NeedsOrganization, ownerFlow.Current.Phase);

        using (var bootstrap = new OrganizationAccessViewModel(
                   ownerFlow,
                   ownerFlow.Session!,
                   ownerFlow.Current.User!,
                   server))
        {
            bootstrap.OrganizationName = "Bootstrap E2E";
            bootstrap.BootstrapToken = bootstrapToken;
            await bootstrap.BootstrapOrganizationCommand.ExecuteAsync(null);
            Assert.Null(bootstrap.Error);
        }

        Assert.Equal(SessionPhase.SignedIn, ownerFlow.Current.Phase);
        Assert.Equal("OWNER", (await ownerFlow.Session!.Client.GetAccessSummaryAsync(
            ownerFlow.Session.Token, CancellationToken.None)).Role);

        var memberEmail = $"invited-{Guid.NewGuid():N}@bootstrap.test";
        var invitation = await ownerFlow.Session.Client.CreateInvitationAsync(
            ownerFlow.Session.Token, memberEmail, "MEMBER", CancellationToken.None);

        var memberVault = new PlainFileTokenVault(
            Path.Combine(_scratch.FullName, "member-vault.json"));
        var memberSettings = new SettingsStore(
            Path.Combine(_scratch.FullName, "member-settings.json"));
        using var memberFlow = new DesktopAuthFlow(
            factory, memberVault, memberSettings, NullLogger<DesktopAuthFlow>.Instance);
        await memberFlow.SignUpAsync(
            server, "Invited Teammate", memberEmail, "Password123!", CancellationToken.None);
        Assert.Equal(SessionPhase.NeedsOrganization, memberFlow.Current.Phase);

        using (var access = new OrganizationAccessViewModel(
                   memberFlow,
                   memberFlow.Session!,
                   memberFlow.Current.User!,
                   server))
        {
            access.InvitationInput = $"nodescope-invite-v1:{invitation.Token}";
            await access.AcceptInvitationCommand.ExecuteAsync(null);
            Assert.Null(access.Error);
        }

        Assert.Equal(SessionPhase.SignedIn, memberFlow.Current.Phase);
        Assert.Equal("MEMBER", (await memberFlow.Session!.Client.GetAccessSummaryAsync(
            memberFlow.Session.Token, CancellationToken.None)).Role);
        var roster = await memberFlow.Session.Client.GetOrganizationMembersAsync(
            memberFlow.Session.Token, CancellationToken.None);
        Assert.Contains(roster, member => member.Email == ownerEmail && member.Role == "OWNER");
        Assert.Contains(roster, member => member.Email == memberEmail && member.Role == "MEMBER");
    }
}
