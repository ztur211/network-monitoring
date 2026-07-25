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

/// <summary>
/// The settings view on the headless platform: the cards render, the manage-only
/// sections follow the role, and the enrollment code reveals the install commands.
/// </summary>
public sealed class SettingsViewTests : IDisposable
{
    private static readonly Uri Server = new("https://appliance.local/");

    private readonly FakeApplianceClient _client = new(Server);
    private readonly DirectoryInfo _scratch = Directory.CreateTempSubdirectory("nodescope-settings-view-");
    private SettingsViewModel? _viewModel;

    public void Dispose()
    {
        _viewModel?.Dispose();
        _client.Dispose();
        _scratch.Delete(recursive: true);
    }

    private async Task<SettingsView> CreateShownViewAsync()
    {
        var store = new SettingsStore(Path.Combine(_scratch.FullName, "settings.json"));
        _viewModel = new SettingsViewModel(
            new ApplianceSession(_client, "token-1"),
            new CurrentUser("user-1", "owner@acme.test", "Owner"),
            store,
            NullLogger.Instance);
        await _viewModel.Initialization;
        var view = new SettingsView { DataContext = _viewModel };
        var window = new Window { Content = view };
        window.Show();
        return view;
    }

    [AvaloniaFact]
    public async Task The_profile_fields_bind_to_the_signed_in_user()
    {
        var view = await CreateShownViewAsync();

        Assert.Equal("Owner", view.FindControl<TextBox>("ProfileNameBox")!.Text);
        Assert.Equal("owner@acme.test", view.FindControl<TextBox>("ProfileEmailBox")!.Text);
    }

    [AvaloniaFact]
    public async Task Manage_sections_show_for_an_owner_and_hide_for_a_member()
    {
        var owner = await CreateShownViewAsync();
        Assert.True(owner.FindControl<Border>("AgentsCard")!.IsVisible);
        Assert.True(owner.FindControl<Border>("SnmpCard")!.IsVisible);
        _viewModel!.Dispose();

        _client.AccessToReturn = new AccessSummary("MEMBER", [], false);
        var member = await CreateShownViewAsync();
        Assert.False(member.FindControl<Border>("AgentsCard")!.IsVisible);
        Assert.False(member.FindControl<Border>("SnmpCard")!.IsVisible);
    }

    [AvaloniaFact]
    public async Task Generating_a_code_reveals_the_install_command()
    {
        var view = await CreateShownViewAsync();

        await _viewModel!.GenerateEnrollmentCodeCommand.ExecuteAsync(null);
        view.UpdateLayout();

        Assert.Equal("code-abc123", view.FindControl<TextBlock>("EnrollmentCodeText")!.Text);
    }

    [AvaloniaFact]
    public async Task The_data_sources_card_lists_the_browser_source()
    {
        var view = await CreateShownViewAsync();

        Assert.Equal(1, view.FindControl<ItemsControl>("DataSourceList")!.ItemCount);
    }

    [AvaloniaFact]
    public async Task The_credential_form_toggles_between_v2c_and_v3_fields()
    {
        var view = await CreateShownViewAsync();

        _viewModel!.ToggleCredentialFormCommand.Execute(null);
        view.UpdateLayout();
        Assert.True(view.FindControl<StackPanel>("CredentialForm")!.IsVisible);
        Assert.True(view.FindControl<TextBox>("CommunityBox")!.IsVisible);

        _viewModel.CredentialIsV3 = true;
        view.UpdateLayout();
        Assert.False(view.FindControl<TextBox>("CommunityBox")!.IsVisible);
    }
}
