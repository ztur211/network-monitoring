using System.Text.Json;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Media.Imaging;
using Avalonia.Threading;
using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using NodeScope.Desktop.Views;
using Xunit;

namespace NodeScope.Desktop.Tests;

public sealed class AlertsViewTests : IDisposable
{
    private static readonly Uri Server = new("https://appliance.local/");
    private readonly FakeApplianceClient _client = new(Server);
    private readonly FakeRealtimeConnection _realtime = new();
    private AlertsViewModel? _viewModel;
    private Window? _window;

    public void Dispose()
    {
        _window?.Close();
        _viewModel?.Dispose();
        _client.Dispose();
        _realtime.Dispose();
    }

    [AvaloniaFact]
    public async Task Owner_sees_feed_and_configuration_tabs()
    {
        var now = DateTime.UtcNow;
        _client.AlertEvents.Add(new AlertEvent(
            "event-1",
            "org-1",
            "rule-1",
            "Device down",
            "device-1",
            "FIRING",
            "CRITICAL",
            Json("""{"state":"DOWN"}"""),
            "rule-1:device-1",
            now));
        var channelId = Guid.NewGuid().ToString();
        _client.AlertChannels.Add(new AlertChannel(
            channelId,
            "org-1",
            "INAPP",
            "Desktop",
            true,
            Json("{}"),
            1,
            now,
            now));
        _client.AlertRules.Add(new AlertRule(
            Guid.NewGuid().ToString(),
            "org-1",
            "Device down",
            true,
            "STATE_TRANSITION",
            Json("""{"all":true}"""),
            ["DOWN"],
            null,
            null,
            null,
            null,
            "CRITICAL",
            [channelId],
            60,
            true,
            1,
            now,
            now));
        var view = await CreateShownViewAsync();

        Assert.False(view.FindControl<Border>("AccessCard")!.IsVisible);
        Assert.Equal(1, view.FindControl<ItemsControl>("AlertFeed")!.ItemCount);
        await CaptureAsync("NODESCOPE_DESKTOP_ALERTS_FEED_SHOT");

        var tabs = view.FindControl<TabControl>("AlertsTabs")!;
        tabs.SelectedIndex = 1;
        Dispatcher.UIThread.RunJobs();
        Assert.Equal(1, view.FindControl<ItemsControl>("AlertChannelList")!.ItemCount);
        await CaptureAsync("NODESCOPE_DESKTOP_ALERTS_CHANNELS_SHOT");

        tabs.SelectedIndex = 2;
        Dispatcher.UIThread.RunJobs();
        Assert.Equal(1, view.FindControl<ItemsControl>("AlertRuleList")!.ItemCount);
        await CaptureAsync("NODESCOPE_DESKTOP_ALERTS_RULES_SHOT");
    }

    [AvaloniaFact]
    public async Task Member_sees_admin_access_notice_and_no_tabs()
    {
        _client.AccessToReturn = new AccessSummary("MEMBER", [], false);
        var view = await CreateShownViewAsync();

        Assert.True(view.FindControl<Border>("AccessCard")!.IsVisible);
        Assert.False(view.FindControl<TabControl>("AlertsTabs")!.IsVisible);
    }

    private async Task<AlertsView> CreateShownViewAsync()
    {
        _viewModel = new AlertsViewModel(
            new ApplianceSession(_client, "token-1"),
            _realtime,
            NullLogger<AlertsViewModel>.Instance);
        await _viewModel.Initialization;
        var view = new AlertsView { DataContext = _viewModel };
        _window = new Window
        {
            Width = 1100,
            Height = 760,
            Content = view,
        };
        _window.Show();
        return view;
    }

    private async Task CaptureAsync(string variable)
    {
        var path = Environment.GetEnvironmentVariable(variable);
        if (string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        Dispatcher.UIThread.RunJobs();
        using var frame = _window!.CaptureRenderedFrame();
        Assert.NotNull(frame);
        using var encoded = new MemoryStream();
        frame.Save(encoded, PngBitmapEncoderOptions.Default);
        await File.WriteAllBytesAsync(
            path,
            encoded.ToArray(),
            TestContext.Current.CancellationToken);
    }

    private static JsonElement Json(string value)
    {
        using var document = JsonDocument.Parse(value);
        return document.RootElement.Clone();
    }
}
