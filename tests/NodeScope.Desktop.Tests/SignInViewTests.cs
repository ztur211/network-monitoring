using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Auth;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using NodeScope.Desktop.Views;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// The native sign-in form on the headless platform: field visibility per mode,
/// validation before any network call, and a submit that drives the real flow.
/// </summary>
public sealed class SignInViewTests : IDisposable
{
    private static readonly Uri Server = new("https://appliance.local/");

    private readonly DirectoryInfo _scratch = Directory.CreateTempSubdirectory("nodescope-signin-view-");
    private readonly FakeApplianceClientFactory _clients = new();
    private readonly InMemoryTokenVault _vault = new();
    private DesktopAuthFlow? _flow;

    public void Dispose()
    {
        _flow?.Dispose();
        _scratch.Delete(recursive: true);
    }

    private (SignInView View, SignInViewModel Model) CreateShownView()
    {
        var settings = new SettingsStore(Path.Combine(_scratch.FullName, "settings.json"));
        _flow = new DesktopAuthFlow(_clients, _vault, settings, NullLogger<DesktopAuthFlow>.Instance);
        var model = new SignInViewModel(_flow, settings);
        var view = new SignInView { DataContext = model };
        var window = new Window { Content = view };
        window.Show();
        return (view, model);
    }

    [AvaloniaFact]
    public void Sign_in_mode_hides_the_name_field_and_create_mode_reveals_it()
    {
        var (view, model) = CreateShownView();

        Assert.False(view.FindControl<TextBox>("NameBox")!.IsVisible);
        Assert.Equal("Sign in", view.FindControl<Button>("SubmitButton")!.Content);
        Assert.Equal("Sign in to your appliance", view.FindControl<TextBlock>("TitleText")!.Text);

        model.SwitchModeCommand.Execute(null);

        Assert.True(view.FindControl<TextBox>("NameBox")!.IsVisible);
        Assert.Equal("Create account", view.FindControl<Button>("SubmitButton")!.Content);
        Assert.Equal("Create your account", view.FindControl<TextBlock>("TitleText")!.Text);
    }

    [AvaloniaFact]
    public async Task An_invalid_url_or_missing_credentials_error_before_any_client_is_created()
    {
        var (view, model) = CreateShownView();

        model.ServerUrl = "not a url";
        model.Email = "owner@acme.test";
        model.Password = "pw";
        await model.SubmitCommand.ExecuteAsync(null);
        Assert.Contains("appliance URL", view.FindControl<TextBlock>("ErrorText")!.Text, StringComparison.Ordinal);

        model.ServerUrl = Server.AbsoluteUri;
        model.Password = string.Empty;
        await model.SubmitCommand.ExecuteAsync(null);
        Assert.Contains("email and password", view.FindControl<TextBlock>("ErrorText")!.Text, StringComparison.Ordinal);

        Assert.Empty(_clients.Created);
    }

    [AvaloniaFact]
    public async Task Submitting_valid_credentials_signs_the_flow_in_and_clears_the_password()
    {
        var (_, model) = CreateShownView();

        model.ServerUrl = Server.AbsoluteUri;
        model.Email = "owner@acme.test";
        model.Password = "devpassword123";
        await model.SubmitCommand.ExecuteAsync(null);
        // The shell projects every snapshot onto the form, including the signed-in one.
        model.Apply(_flow!.Current);

        Assert.Equal(SessionPhase.SignedIn, _flow.Current.Phase);
        Assert.Equal(("owner@acme.test", "devpassword123"), _clients.Last.LastSignIn);
        Assert.Equal(string.Empty, model.Password);
    }

    [AvaloniaFact]
    public async Task Create_mode_submits_the_name_through_the_sign_up_wire()
    {
        var (_, model) = CreateShownView();

        model.SwitchModeCommand.Execute(null);
        model.ServerUrl = Server.AbsoluteUri;
        model.Name = "New Owner";
        model.Email = "new@acme.test";
        model.Password = "devpassword123";
        await model.SubmitCommand.ExecuteAsync(null);

        Assert.Equal(("New Owner", "new@acme.test", "devpassword123"), _clients.Last.LastSignUp);
        Assert.Equal(SessionPhase.SignedIn, _flow!.Current.Phase);
    }
}
