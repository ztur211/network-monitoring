using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Realtime;
using NodeScope.Desktop.Tests.Fakes;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// The workstation collector's cycle against the fakes: measured values ride the
/// submission, failed probes drop their field instead of faking a zero, an all-null
/// cycle submits nothing, and a dead wire never throws out of a cycle.
/// </summary>
public sealed class WorkstationCollectorTests : IDisposable
{
    private static readonly Uri Server = new("https://appliance.local/");

    private readonly FakeApplianceClient _client = new(Server);
    private readonly FakeRealtimeConnection _realtime = new();
    private readonly TestClock _clock = new(new DateTimeOffset(2026, 7, 25, 12, 0, 0, TimeSpan.Zero));
    private readonly WorkstationCollector _collector;

    public WorkstationCollectorTests() => _collector = new WorkstationCollector(
        new ApplianceSession(_client, "token-1"), _realtime, NullLogger.Instance, _clock);

    public void Dispose()
    {
        _collector.Dispose();
        _client.Dispose();
        _realtime.Dispose();
    }

    [Fact]
    public async Task A_cycle_submits_the_measured_sample_without_a_quality_field()
    {
        _realtime.PingRoundTrip = TimeSpan.FromMilliseconds(17.4);
        // Each probe "transfers" for one virtual second: 1,000,000 B down -> 8 Mbps,
        // 100,000 B up -> 0.8 Mbps.
        _client.BandwidthEchoDelay = _ =>
        {
            _clock.Advance(TimeSpan.FromSeconds(1));
            return Task.CompletedTask;
        };

        await _collector.CollectAndSubmitAsync();

        var sample = Assert.Single(_realtime.SubmittedMetrics);
        Assert.Equal(17, sample.Latency);
        Assert.Equal(8, sample.BandwidthDown);
        Assert.Equal(0.8, sample.BandwidthUp);
        Assert.Null(sample.ConnectionQuality);
        Assert.Equal(WorkstationCollector.UploadPayloadBytes, Assert.Single(_client.UploadedEchoPayloads));
    }

    [Fact]
    public async Task A_failed_probe_drops_its_field_instead_of_reporting_zero()
    {
        _realtime.PingRoundTrip = TimeSpan.FromMilliseconds(20);
        _client.BandwidthEchoFailure = new HttpRequestException("echo down");

        await _collector.CollectAndSubmitAsync();

        var sample = Assert.Single(_realtime.SubmittedMetrics);
        Assert.Equal(20, sample.Latency);
        Assert.Null(sample.BandwidthDown);
        Assert.Null(sample.BandwidthUp);
    }

    [Fact]
    public async Task An_all_null_cycle_submits_nothing()
    {
        _realtime.PingRoundTrip = null;
        _client.BandwidthEchoFailure = new HttpRequestException("echo down");

        await _collector.CollectAndSubmitAsync();

        Assert.Empty(_realtime.SubmittedMetrics);
    }

    [Fact]
    public async Task A_dead_wire_swallows_the_submit_failure()
    {
        _realtime.SendFailure = new RealtimeUnavailableException("down");
        _client.BandwidthEchoDelay = _ =>
        {
            _clock.Advance(TimeSpan.FromSeconds(1));
            return Task.CompletedTask;
        };

        await _collector.CollectAndSubmitAsync(); // must not throw

        Assert.Empty(_realtime.SubmittedMetrics);
    }

    [Fact]
    public void Start_is_idempotent()
    {
        _collector.Start();
        var running = _collector.Running;
        _collector.Start();
        Assert.Same(running, _collector.Running);
    }

    [Theory]
    [InlineData(1_000_000, 1.0, 8.0)]
    [InlineData(100_000, 0.5, 1.6)]
    [InlineData(123_456, 1.0, 0.99)]
    public void Mbps_conversion_matches_the_web_collector(long bytes, double seconds, double expected) =>
        Assert.Equal(expected, WorkstationCollector.ToMbps(bytes, TimeSpan.FromSeconds(seconds)));

    [Fact]
    public void A_sub_resolution_transfer_is_unmeasurable_not_infinite() =>
        Assert.Null(WorkstationCollector.ToMbps(1_000_000, TimeSpan.Zero));
}
