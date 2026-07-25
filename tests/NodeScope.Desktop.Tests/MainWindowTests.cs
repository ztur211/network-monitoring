using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.VisualTree;
using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Auth;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using NodeScope.Desktop.Views;
using Xunit;

namespace NodeScope.Desktop.Tests;

public sealed class MainWindowTests : IDisposable
{
    private static readonly Uri Server = new("https://appliance.local/");

    private readonly DirectoryInfo _scratch = Directory.CreateTempSubdirectory("nodescope-shell-tests-");
    private readonly FakeApplianceClientFactory _clients = new();
    private readonly FakeBrowserLauncher _browser = new();
    private readonly InMemoryTokenVault _vault = new();
    private readonly DesktopAuthFlow _flow;
    private readonly MainWindowViewModel _shell;

    public MainWindowTests()
    {
        var settings = new SettingsStore(Path.Combine(_scratch.FullName, "settings.json"));
        _flow = new DesktopAuthFlow(
            _clients, _vault, settings, _browser, NullLogger<DesktopAuthFlow>.Instance);
        _shell = new MainWindowViewModel(_flow, settings);
    }

    public void Dispose()
    {
        _shell.Dispose();
        _flow.Dispose();
        _scratch.Delete(recursive: true);
    }

    [AvaloniaFact]
    public void The_shell_opens_signed_out_on_the_sign_in_view()
    {
        var window = new MainWindow { DataContext = _shell };
        window.Show();

        Assert.Equal("NodeScope", window.Title);
        Assert.IsType<SignInViewModel>(_shell.Content);
        Assert.Single(window.GetVisualDescendants().OfType<SignInView>());
        Assert.Equal("Not signed in", window.FindControl<TextBlock>("StatusText")!.Text);
    }

    [AvaloniaFact]
    public async Task Completing_the_sign_in_switches_the_shell_to_the_workspace()
    {
        var window = new MainWindow { DataContext = _shell };
        window.Show();

        _flow.StartSignIn(Server);
        Assert.Equal("Waiting for the browser sign-in…", window.FindControl<TextBlock>("StatusText")!.Text);

        var state = StateFrom(_browser.LastOpened!);
        await _flow.HandleCallbackAsync(
            new Uri($"nodescope://auth/callback?code=c1&state={Uri.EscapeDataString(state)}"),
            CancellationToken.None);

        Assert.IsType<WorkspaceViewModel>(_shell.Content);
        var workspace = Assert.Single(window.GetVisualDescendants().OfType<WorkspaceView>());
        Assert.Empty(window.GetVisualDescendants().OfType<SignInView>());

        Assert.Equal("Owner", workspace.FindControl<TextBlock>("UserChip")!.Text);
        Assert.Equal("Map", workspace.FindControl<TextBlock>("SectionTitle")!.Text);
        Assert.Equal("Signed in as Owner - appliance.local", window.FindControl<TextBlock>("StatusText")!.Text);
    }

    [AvaloniaFact]
    public async Task Signing_out_returns_to_the_sign_in_view_with_the_server_prefilled()
    {
        var window = new MainWindow { DataContext = _shell };
        window.Show();

        _vault.Entry = new VaultEntry(Server, "tok");
        await _flow.RestoreAsync(CancellationToken.None);
        Assert.IsType<WorkspaceViewModel>(_shell.Content);

        await _flow.SignOutAsync(CancellationToken.None);

        var signIn = Assert.IsType<SignInViewModel>(_shell.Content);
        Assert.Single(window.GetVisualDescendants().OfType<SignInView>());
        Assert.Equal(Server.AbsoluteUri, signIn.ServerUrl);
    }

    private static string StateFrom(Uri authorizeUrl)
    {
        foreach (var pair in authorizeUrl.Query.TrimStart('?').Split('&'))
        {
            var parts = pair.Split('=', 2);
            if (parts[0] == "state")
            {
                return Uri.UnescapeDataString(parts[1]);
            }
        }

        throw new InvalidOperationException("no state in the authorize URL");
    }
}
