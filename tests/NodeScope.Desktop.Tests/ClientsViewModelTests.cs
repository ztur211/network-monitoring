using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Realtime;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// The clients tab's live half, web-parity contracts: the pushed sample overrides the
/// REST snapshot, the neutral dot only shows for a fresh push, staleness starts at 90
/// seconds (three push cycles), and a reconnect refetches the snapshot.
/// </summary>
public sealed class ClientsViewModelTests : IDisposable
{
    private static readonly Uri Server = new("https://appliance.local/");
    private static readonly DateTimeOffset Start = new(2026, 7, 25, 12, 0, 0, TimeSpan.Zero);

    private readonly FakeApplianceClient _client = new(Server);
    private readonly FakeRealtimeConnection _realtime = new();
    private readonly TestClock _clock = new(Start);
    private ClientsViewModel? _viewModel;

    public void Dispose()
    {
        _viewModel?.Dispose();
        _client.Dispose();
        _realtime.Dispose();
    }

    private async Task<ClientsViewModel> CreateAsync()
    {
        _viewModel = new ClientsViewModel(
            new ApplianceSession(_client, "token-1"), _realtime, NullLogger.Instance, _clock);
        await _viewModel.Initialization;
        return _viewModel;
    }

    private static ClientMetrics Metrics(
        double? down = 120.5, double? up = 12.25, double? latency = 18, string? quality = null,
        DateTimeOffset? at = null) =>
        new(down, up, latency, quality, (at ?? Start).UtcDateTime);

    [Fact]
    public async Task Without_any_push_the_stored_reading_shows_dimmed_without_the_dot()
    {
        _client.ClientsToReturn = new ClientsSummary(
            new ClientDevice("agent", "Linux", Metrics(latency: 40)),
            new ClientAgentStatus(false, "Desktop Agent coming post-MVP."));

        var viewModel = await CreateAsync();

        // Web parity: the REST snapshot renders, but only a live push earns the dot.
        Assert.Contains("40 ms", viewModel.MetricsLine, StringComparison.Ordinal);
        Assert.False(viewModel.IsLive);
        Assert.True(viewModel.IsStale);
        Assert.Equal(0.45, viewModel.CardOpacity);
    }

    [Fact]
    public async Task A_push_overrides_the_snapshot_and_lights_the_dot()
    {
        _client.ClientsToReturn = new ClientsSummary(
            new ClientDevice("agent", "Linux", Metrics(latency: 40)),
            new ClientAgentStatus(false, "message"));
        var viewModel = await CreateAsync();

        _realtime.RaiseMetricsUpdate(new MetricsUpdateEvent(
            Metrics(down: 250, up: 25, latency: 12), ["browser"]));

        Assert.Contains("↓ 250 Mbps", viewModel.MetricsLine, StringComparison.Ordinal);
        Assert.Contains("12 ms", viewModel.MetricsLine, StringComparison.Ordinal);
        Assert.True(viewModel.IsLive);
        Assert.False(viewModel.IsStale);
        Assert.Equal(1.0, viewModel.CardOpacity);
        Assert.Equal("Updated 12:00:00", viewModel.UpdatedLine);
    }

    [Fact]
    public async Task The_sample_goes_stale_ninety_seconds_after_its_timestamp()
    {
        var viewModel = await CreateAsync();
        _realtime.RaiseMetricsUpdate(new MetricsUpdateEvent(Metrics(), ["browser"]));
        Assert.True(viewModel.IsLive);

        _clock.Advance(TimeSpan.FromSeconds(89));
        Assert.False(viewModel.IsStale);

        _clock.Advance(TimeSpan.FromSeconds(2));
        Assert.True(viewModel.IsStale);
        Assert.False(viewModel.IsLive);
        Assert.Equal(0.45, viewModel.CardOpacity);
    }

    [Fact]
    public async Task A_quality_field_joins_the_metrics_line_uppercased()
    {
        var viewModel = await CreateAsync();

        // The desktop collector never submits quality, but a browser client on the
        // same account can - the push carries whatever was stored.
        _realtime.RaiseMetricsUpdate(new MetricsUpdateEvent(Metrics(quality: "4g"), ["browser"]));

        Assert.Contains("4G", viewModel.MetricsLine, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Without_metrics_the_empty_state_names_the_cadence()
    {
        var viewModel = await CreateAsync();
        Assert.Equal("No live metrics yet - data updates every 30 seconds.", viewModel.MetricsLine);
        Assert.Null(viewModel.UpdatedLine);
    }

    [Fact]
    public async Task A_reconnect_refetches_the_snapshot()
    {
        var viewModel = await CreateAsync();
        Assert.Equal("Linux", viewModel.PlatformLine);

        _client.ClientsToReturn = new ClientsSummary(
            new ClientDevice("agent", "FreeBSD", null),
            new ClientAgentStatus(false, "message"));
        _realtime.RaiseReconnected();

        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(5);
        while (viewModel.PlatformLine != "FreeBSD")
        {
            Assert.True(DateTime.UtcNow < deadline, "timed out waiting for the reconnect reload");
            await Task.Delay(10, TestContext.Current.CancellationToken);
        }
    }
}
