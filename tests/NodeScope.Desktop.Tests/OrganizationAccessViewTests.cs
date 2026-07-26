using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Auth;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using NodeScope.Desktop.Views;
using Xunit;

namespace NodeScope.Desktop.Tests;

public sealed class OrganizationAccessViewTests : IDisposable
{
    private static readonly Uri Server = new("https://appliance.local/");

    private readonly DirectoryInfo _scratch =
        Directory.CreateTempSubdirectory("nodescope-org-access-view-");
    private readonly FakeApplianceClientFactory _clients = new();
    private readonly InMemoryTokenVault _vault = new();
    private readonly DesktopAuthFlow _flow;
    private OrganizationAccessViewModel? _viewModel;

    public OrganizationAccessViewTests()
    {
        var settings = new SettingsStore(Path.Combine(_scratch.FullName, "settings.json"));
        _clients.Configure = client =>
            client.AccessFailure = new ApplianceApiException("ORG_002", "NOT_AN_ORG_MEMBER", 403);
        _flow = new DesktopAuthFlow(
            _clients, _vault, settings, NullLogger<DesktopAuthFlow>.Instance);
    }

    public void Dispose()
    {
        _viewModel?.Dispose();
        _flow.Dispose();
        _scratch.Delete(recursive: true);
    }

    [AvaloniaFact]
    public async Task The_gate_exposes_both_native_ways_into_an_organization()
    {
        await _flow.SignInAsync(
            Server, "teammate@acme.test", "devpassword123", CancellationToken.None);
        _viewModel = new OrganizationAccessViewModel(
            _flow, _flow.Session!, _flow.Current.User!, Server);
        var view = new OrganizationAccessView { DataContext = _viewModel };
        var window = new Window { Content = view };
        window.Show();

        Assert.NotNull(view.FindControl<TextBox>("InvitationCodeBox"));
        Assert.Equal(
            "Join organization",
            view.FindControl<Button>("AcceptInvitationButton")!.Content);
        Assert.Equal(
            "Request access",
            view.FindControl<Button>("RequestAccessButton")!.Content);
        Assert.NotNull(view.FindControl<Expander>("BootstrapExpander"));
        Assert.Equal(
            "Create first organization",
            view.FindControl<Button>("BootstrapOrganizationButton")!.Content);
        Assert.False(view.FindControl<ProgressBar>("BusyIndicator")!.IsVisible);
    }
}
