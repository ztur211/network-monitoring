using System.Globalization;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NodeScope.Contracts.Realtime;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Realtime.Infrastructure;

/// <summary>
/// Pushes each user their latest browser-collector reading on a fixed cadence. Deliberately
/// scheduled rather than echoed on submit: every client a user has open then shows the same
/// value at the same time, whichever one reported it.
/// </summary>
/// <remarks>
/// Implements <see cref="IHostedService"/> directly rather than inheriting
/// <c>BackgroundService</c>, per Decision 6.
/// </remarks>
internal sealed partial class MetricsPushService : IHostedService, IDisposable
{
    /// <summary>The only source today; the shape is a list because the DTO always carried one.</summary>
    private static readonly string[] BrowserSource = ["browser"];

    private readonly IServiceScopeFactory _scopes;
    private readonly IRealtimeService _realtime;
    private readonly ILogger<MetricsPushService> _logger;
    private readonly TimeSpan _interval;
    private readonly CancellationTokenSource _stopping = new();
    private Task? _loop;

    public MetricsPushService(
        IServiceScopeFactory scopes,
        IRealtimeService realtime,
        IConfiguration configuration,
        ILogger<MetricsPushService> logger)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        _scopes = scopes;
        _realtime = realtime;
        _logger = logger;
        _interval = TimeSpan.FromSeconds(
            int.TryParse(
                configuration["REFRESH_INTERVAL_SECONDS"],
                NumberStyles.Integer,
                CultureInfo.InvariantCulture,
                out var seconds) && seconds > 0
                ? seconds
                : 30);
    }

    /// <summary>A reading older than three cycles is not live, so it is not pushed.</summary>
    private TimeSpan Freshness => _interval * 3;

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _loop = RunAsync(_stopping.Token);
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        await _stopping.CancelAsync();
        if (_loop is not null)
        {
            await _loop.WaitAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    public void Dispose() => _stopping.Dispose();

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(_interval);
        while (await timer.WaitForNextTickAsync(cancellationToken).ConfigureAwait(false))
        {
            try
            {
                await PushAsync(cancellationToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
#pragma warning disable CA1031 // One bad cycle must not end the loop for every user.
            catch (Exception exception)
            {
                Log.CycleFailed(_logger, exception);
            }
#pragma warning restore CA1031
        }
    }

    private async Task PushAsync(CancellationToken cancellationToken)
    {
        using var scope = _scopes.CreateScope();
        var metrics = scope.ServiceProvider.GetRequiredService<IUserMetricsService>();
        foreach (var snapshot in await metrics.LatestPerUserAsync(Freshness, cancellationToken))
        {
            await _realtime.PushToUserAsync(
                snapshot.UserId,
                WsEvents.MetricsUpdate,
                new
                {
                    metrics = new
                    {
                        bandwidthDown = snapshot.Sample.BandwidthDown,
                        bandwidthUp = snapshot.Sample.BandwidthUp,
                        latency = snapshot.Sample.Latency,
                        connectionQuality = snapshot.Sample.ConnectionQuality,
                        timestamp = IsoTimestamp.Of(snapshot.Timestamp),
                    },
                    sourceTypes = BrowserSource,
                    timestamp = IsoTimestamp.Now(),
                },
                cancellationToken);
        }
    }

    private static partial class Log
    {
        [LoggerMessage(Level = LogLevel.Warning, Message = "A metrics push cycle failed; the next one will retry")]
        public static partial void CycleFailed(ILogger logger, Exception exception);
    }
}
