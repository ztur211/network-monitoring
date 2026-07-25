using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using NodeScope.Desktop.Views;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// The wizard overlay on the headless platform: transcript, chips, fields, and the
/// skip affordance all render bound.
/// </summary>
public sealed class OnboardingViewTests : IDisposable
{
    private static readonly Uri Server = new("https://appliance.local/");

    private readonly FakeApplianceClient _client = new(Server);
    private OnboardingViewModel? _viewModel;

    public void Dispose()
    {
        _viewModel?.Dispose();
        _client.Dispose();
    }

    private async Task<OnboardingView> CreateShownViewAsync()
    {
        _viewModel = new OnboardingViewModel(
            new ApplianceSession(_client, "token-1"), NullLogger.Instance, close: () => { });
        await _viewModel.Initialization;
        var view = new OnboardingView { DataContext = _viewModel };
        var window = new Window { Content = view };
        window.Show();
        return view;
    }

    [AvaloniaFact]
    public async Task The_welcome_step_renders_its_message_and_chip()
    {
        var view = await CreateShownViewAsync();

        Assert.Equal(1, view.FindControl<ItemsControl>("TranscriptList")!.ItemCount);
        Assert.Equal(1, view.FindControl<ItemsControl>("ChipRow")!.ItemCount);
        Assert.True(view.FindControl<Button>("SkipButton")!.IsVisible);
        Assert.False(view.FindControl<StackPanel>("FieldsPanel")!.IsVisible);
    }

    [AvaloniaFact]
    public async Task A_fields_step_shows_the_inputs_and_continue()
    {
        _client.TurnsToReturn.Add(new OnboardingTurn(
            "networkName",
            "What should we call it?",
            [],
            [new OnboardingField("name", "text", "Network name", "Home", true)],
            false));

        var view = await CreateShownViewAsync();

        Assert.True(view.FindControl<StackPanel>("FieldsPanel")!.IsVisible);
        Assert.True(view.FindControl<Button>("ContinueButton")!.IsVisible);
    }
}
