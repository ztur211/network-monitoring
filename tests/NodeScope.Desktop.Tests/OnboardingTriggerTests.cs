using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Auth;
using NodeScope.Desktop.Bim;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// The wizard's auto-open rule on the workspace: no network + a role that may run
/// the wizard opens it; an existing network, a MEMBER, or a dismissal keeps it shut.
/// </summary>
public sealed class OnboardingTriggerTests : IDisposable
{
    private static readonly Uri Server = new("https://appliance.local/");

    private readonly FakeApplianceClient _client = new(Server);
    private readonly DirectoryInfo _scratch = Directory.CreateTempSubdirectory("nodescope-wizard-trigger-");
    private readonly FakeApplianceClientFactory _factory = new();
    private readonly FakeRealtimeConnection _realtime = new();
    private DesktopAuthFlow? _flow;
    private WorkspaceViewModel? _workspace;

    public void Dispose()
    {
        _workspace?.Dispose();
        _flow?.Dispose();
        _realtime.Dispose();
        _client.Dispose();
        _scratch.Delete(recursive: true);
    }

    private async Task<WorkspaceViewModel> CreateWorkspaceAsync()
    {
        var store = new SettingsStore(Path.Combine(_scratch.FullName, "settings.json"));
        _flow = new DesktopAuthFlow(
            _factory,
            new InMemoryTokenVault(),
            store,
            new FakeBrowserLauncher(),
            NullLogger<DesktopAuthFlow>.Instance);
        _workspace = new WorkspaceViewModel(
            new CurrentUser("user-1", "owner@acme.test", "Owner"),
            Server,
            _flow,
            new ApplianceSession(_client, "token-1"),
            store,
            NullLoggerFactory.Instance,
            new FakeIfcTessellator(),
            _realtime);
        await _workspace.WizardCheck;
        return _workspace;
    }

    [Fact]
    public async Task A_network_less_org_opens_the_wizard_for_an_owner()
    {
        var workspace = await CreateWorkspaceAsync();

        Assert.NotNull(workspace.Wizard);
        await workspace.Wizard.Initialization;
        Assert.NotEmpty(workspace.Wizard.Transcript);
    }

    [Fact]
    public async Task An_org_with_a_network_does_not()
    {
        _client.Networks.Add(new NetworkSummary("n1", "Home", null, null, null, null, null, null, 1));

        var workspace = await CreateWorkspaceAsync();

        Assert.Null(workspace.Wizard);
    }

    [Fact]
    public async Task A_member_never_sees_it()
    {
        _client.AccessToReturn = new AccessSummary("MEMBER", [], false);

        var workspace = await CreateWorkspaceAsync();

        Assert.Null(workspace.Wizard);
    }

    [Fact]
    public async Task Skipping_closes_it_for_the_session()
    {
        var workspace = await CreateWorkspaceAsync();
        await workspace.Wizard!.Initialization;

        await workspace.Wizard.SkipCommand.ExecuteAsync(null);

        Assert.Null(workspace.Wizard);
        Assert.Equal(1, _client.SkipCalls);
    }
}
