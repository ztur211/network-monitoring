using Microsoft.Extensions.Logging;
using NodeScope.Desktop.Api;

namespace NodeScope.Desktop.Realtime;

/// <summary>
/// The desktop's side of the clients metrics loop - a port of the web browser collector.
/// Every 30 seconds it measures latency (one hub ping) alongside bandwidth (a sequential
/// download/upload against <c>/api/bandwidth/echo</c>) and submits the sample over the
/// realtime wire; the server pushes each user's latest sample back to their whole client
/// group as <c>v1:metrics:update</c> on its own schedule. Cycles run strictly one at a
/// time by construction - the loop awaits each cycle - where the web needed an explicit
/// non-overlap guard around <c>setInterval</c>. Deliberate deviations from the web:
/// no visibility pause (a NOC client runs minimized; the measured workstation is still
/// there), no connection-quality field (<c>navigator.connection</c> has no desktop
/// equivalent), and an all-null cycle submits nothing instead of an empty sample.
/// </summary>
internal sealed class WorkstationCollector : IDisposable
{
    /// <summary>Web parity: one cycle per 30s, first cycle a full interval after start.</summary>
    internal static readonly TimeSpan CollectInterval = TimeSpan.FromSeconds(30);

    /// <summary>Web parity: an unanswered ping stops counting after 5s.</summary>
    internal static readonly TimeSpan PingTimeout = TimeSpan.FromSeconds(5);

    /// <summary>
    /// Web parity: each bandwidth probe is bounded by this timeout, not the server's
    /// goodwill - a hung appliance must not leave a probe pending forever.
    /// </summary>
    internal static readonly TimeSpan BandwidthTimeout = TimeSpan.FromSeconds(10);

    /// <summary>Web parity: the upload probe's payload size.</summary>
    internal const int UploadPayloadBytes = 100_000;

    private readonly ApplianceSession _session;
    private readonly IRealtimeConnection _realtime;
    private readonly ILogger _logger;
    private readonly TimeProvider _time;
    private readonly CancellationTokenSource _lifetime = new();
    private int _started;

    public WorkstationCollector(
        ApplianceSession session,
        IRealtimeConnection realtime,
        ILogger logger,
        TimeProvider? time = null)
    {
        _session = session;
        _realtime = realtime;
        _logger = logger;
        _time = time ?? TimeProvider.System;
    }

    /// <summary>The collection loop; observed by tests.</summary>
    internal Task Running { get; private set; } = Task.CompletedTask;

    public void Start()
    {
        if (Interlocked.Exchange(ref _started, 1) == 1)
        {
            return;
        }

        Running = Task.Run(LoopAsync);
    }

    public void Dispose()
    {
        _lifetime.Cancel();
        _lifetime.Dispose();
    }

    /// <summary>
    /// One measure-and-submit cycle; internal so tests drive it without the 30s clock.
    /// Never throws - a failed cycle collects less, the loop keeps its cadence.
    /// </summary>
    internal async Task CollectAndSubmitAsync()
    {
        // Web parity: latency rides alongside the bandwidth pair, but the two bandwidth
        // probes run sequentially - concurrent directions would halve each other.
        var latencyTask = MeasureLatencyAsync();
        var down = await MeasureDownloadAsync();
        var up = await MeasureUploadAsync();
        var latency = await latencyTask;

        if (latency is null && down is null && up is null)
        {
            return; // nothing measured, nothing to say
        }

        try
        {
            await _realtime.SubmitMetricsAsync(
                new MetricsSubmission(down, up, latency, ConnectionQuality: null), _lifetime.Token);
        }
        catch (RealtimeUnavailableException failure)
        {
            CollectorLog.SubmitFailed(_logger, failure);
        }
    }

    /// <summary>Web parity: bytes*8 / seconds / 1e6, two decimals; sub-resolution is unmeasurable.</summary>
    internal static double? ToMbps(long bytes, TimeSpan elapsed) =>
        elapsed <= TimeSpan.Zero ? null : Math.Round(bytes * 8 / elapsed.TotalSeconds / 1_000_000, 2);

    private async Task LoopAsync()
    {
        while (!_lifetime.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(CollectInterval, _time, _lifetime.Token);
            }
            catch (OperationCanceledException)
            {
                return;
            }

            await CollectAndSubmitAsync();
        }
    }

    private async Task<double?> MeasureLatencyAsync()
    {
        using var timeout = new CancellationTokenSource(PingTimeout, _time);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token, timeout.Token);
        try
        {
            var roundTrip = await _realtime.PingAsync(linked.Token);
            return Math.Round(roundTrip.TotalMilliseconds);
        }
        catch (Exception failure) when (failure is RealtimeUnavailableException or OperationCanceledException)
        {
            return null; // not connected, or the pong never came - no measurement to report
        }
    }

    private async Task<double?> MeasureDownloadAsync()
    {
        using var timeout = new CancellationTokenSource(BandwidthTimeout, _time);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token, timeout.Token);
        try
        {
            var started = _time.GetTimestamp();
            var bytes = await _session.Client.DownloadBandwidthEchoAsync(linked.Token);
            return ToMbps(bytes, _time.GetElapsedTime(started));
        }
        catch (Exception failure) when (
            failure is HttpRequestException or OperationCanceledException or ApplianceApiException)
        {
            return null;
        }
    }

    private async Task<double?> MeasureUploadAsync()
    {
        // Random bytes so no transport layer can compress the probe into a latency test.
        var payload = new byte[UploadPayloadBytes];
        System.Security.Cryptography.RandomNumberGenerator.Fill(payload);

        using var timeout = new CancellationTokenSource(BandwidthTimeout, _time);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token, timeout.Token);
        try
        {
            var started = _time.GetTimestamp();
            await _session.Client.UploadBandwidthEchoAsync(payload, linked.Token);
            return ToMbps(UploadPayloadBytes, _time.GetElapsedTime(started));
        }
        catch (Exception failure) when (
            failure is HttpRequestException or OperationCanceledException or ApplianceApiException)
        {
            return null;
        }
    }
}

internal static partial class CollectorLog
{
    [LoggerMessage(Level = LogLevel.Warning, Message = "Metrics submit failed; the next cycle will retry")]
    public static partial void SubmitFailed(ILogger logger, Exception exception);
}
