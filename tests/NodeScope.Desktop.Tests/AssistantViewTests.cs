using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Realtime;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using NodeScope.Desktop.Views;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// The assistant section on the headless platform: empty state, transcript, banner,
/// error row, and the input gating all render bound.
/// </summary>
public sealed class AssistantViewTests : IDisposable
{
    private static readonly Uri Server = new("https://appliance.local/");

    private readonly FakeApplianceClient _client = new(Server);
    private readonly FakeRealtimeConnection _realtime = new();
    private AssistantViewModel? _viewModel;

    public void Dispose()
    {
        _viewModel?.Dispose();
        _client.Dispose();
        _realtime.Dispose();
    }

    private async Task<AssistantView> CreateShownViewAsync()
    {
        _viewModel = new AssistantViewModel(
            new ApplianceSession(_client, "token-1"), _realtime, NullLogger.Instance);
        await _viewModel.Initialization;
        var view = new AssistantView { DataContext = _viewModel };
        var window = new Window { Content = view };
        window.Show();
        return view;
    }

    [AvaloniaFact]
    public async Task An_empty_transcript_shows_the_starter_prompts()
    {
        var view = await CreateShownViewAsync();

        Assert.True(view.FindControl<StackPanel>("EmptyState")!.IsVisible);
        Assert.Equal(4, view.FindControl<ItemsControl>("SuggestionList")!.ItemCount);
        Assert.False(view.FindControl<Border>("StatusBanner")!.IsVisible);
        // Command-driven enablement lands in IsEffectivelyEnabled, not the local property.
        Assert.False(view.FindControl<Button>("SendButton")!.IsEffectivelyEnabled);
        Assert.Equal("0/20 messages this hour", view.FindControl<TextBlock>("UsageLine")!.Text);
    }

    [AvaloniaFact]
    public async Task A_conversation_renders_bubbles_and_the_clear_affordance()
    {
        var view = await CreateShownViewAsync();
        _viewModel!.Input = "Is my network healthy?";
        await _viewModel.SendCommand.ExecuteAsync(null);
        _realtime.RaiseComplete(new AiCompleteEvent(
            "All good.", "conv-1", 5, 99_995, null, "ok", "2026-07-25T12:00:00.000Z"));

        Assert.False(view.FindControl<StackPanel>("EmptyState")!.IsVisible);
        Assert.Equal(2, view.FindControl<ItemsControl>("TranscriptList")!.ItemCount);
        Assert.True(view.FindControl<Button>("ClearButton")!.IsVisible);
        Assert.False(view.FindControl<Border>("ErrorRow")!.IsVisible);
    }

    [AvaloniaFact]
    public async Task An_exhausted_limit_raises_the_banner_and_locks_the_input()
    {
        _client.UsageToReturn = _client.UsageToReturn with { HourlyUsed = 20 };
        var view = await CreateShownViewAsync();

        Assert.True(view.FindControl<Border>("StatusBanner")!.IsVisible);
        Assert.False(view.FindControl<TextBox>("MessageBox")!.IsEnabled);
        Assert.False(view.FindControl<Button>("SendButton")!.IsEffectivelyEnabled);
    }

    [AvaloniaFact]
    public async Task A_failed_send_shows_the_error_row_with_retry()
    {
        var view = await CreateShownViewAsync();
        _realtime.SendFailure = new InvalidOperationException("not connected");
        _viewModel!.Input = "hello";
        await _viewModel.SendCommand.ExecuteAsync(null);

        Assert.True(view.FindControl<Border>("ErrorRow")!.IsVisible);
        Assert.True(view.FindControl<Button>("RetryButton")!.IsEnabled);
    }
}
