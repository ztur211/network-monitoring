using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NodeScope.Modules.Monitoring.Application.Ingest;
using NodeScope.Modules.Monitoring.Application.Prober;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Monitoring.Infrastructure.Prober;

/// <summary>
/// The embedded prober (Node's <c>prober.service.ts</c>): probes every device with an IP
/// address, across all orgs, on a fixed interval, and reports through the same ingest write
/// path the agent uses (<c>source='prober'</c>). Implements <see cref="IHostedService"/>
/// directly (Decision 6). OFF unless <c>MONITORING_PROBER_ENABLED=true</c>.
/// <para>Overlap containment is the load-bearing part: a tick that fires while the previous
/// cycle runs is dropped with a warning (<see cref="ProberTickGuard"/>), never queued - the
/// historical resource-runaway bug was cycles piling up when the fleet outgrew the interval.
/// The proof recipe greps the logs for "skipping it".</para>
/// <para>A singleton hosted service must not capture scoped services (the realtime-module
/// lesson: a captured scoped DbContext outlives its scope and dies silently), so each page
/// opens a fresh scope: bounded change-tracker growth no matter the fleet size.</para>
/// </summary>
internal sealed partial class EmbeddedProber : IHostedService, IDisposable
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ProberOptions _options;
    private readonly ILogger<EmbeddedProber> _logger;
    private readonly ProberTickGuard _guard = new();
    private readonly CancellationTokenSource _stopping = new();

    private ReachabilityProbe? _probe;
    private Timer? _timer;

    public EmbeddedProber(IServiceScopeFactory scopes, ProberOptions options, ILogger<EmbeddedProber> logger)
    {
        _scopes = scopes;
        _options = options;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (!_options.Enabled)
        {
            return Task.CompletedTask;
        }

        Log.Enabled(_logger, _options.IntervalMs, _options.Concurrency);
        _probe = new ReachabilityProbe(
            _options.IcmpEnabled,
            _options.Ports,
            _options.TimeoutMs,
            message => Log.IcmpUnavailable(_logger, message));
        // First tick after one interval, like Node's setInterval.
        _timer = new Timer(OnTick, null, _options.IntervalMs, _options.IntervalMs);
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        // Node's onModuleDestroy just clears the interval; cancelling additionally makes an
        // in-flight cycle wind down promptly instead of racing container teardown.
        _timer?.Change(Timeout.Infinite, Timeout.Infinite);
        await _stopping.CancelAsync();
    }

    public void Dispose()
    {
        _timer?.Dispose();
        _stopping.Dispose();
    }

    private void OnTick(object? state)
    {
        if (!_guard.TryEnter())
        {
            Log.TickSkipped(_logger, _guard.RecordSkip(), _options.IntervalMs);
            return;
        }

        _ = RunGuardedCycleAsync();
    }

    private async Task RunGuardedCycleAsync()
    {
        try
        {
            await CycleAsync(_stopping.Token);
        }
        catch (OperationCanceledException)
        {
            // Shutdown mid-cycle: expected, not a failed cycle.
        }
        catch (Exception exception) when (exception is not OutOfMemoryException)
        {
            // Anything a cycle throws must die HERE: this task is fire-and-forget off a timer
            // callback, so an escaping exception has no observer (Node: tick().catch(warn)).
            Log.CycleFailed(_logger, exception);
        }
        finally
        {
            _guard.Exit();
        }
    }

    private Task CycleAsync(CancellationToken cancellationToken) =>
        ProberCycle.RunAsync(
            fetchPage: async afterId =>
            {
                using var scope = _scopes.CreateScope();
                return await scope.ServiceProvider.GetRequiredService<IMonitoringRepository>()
                    .ListProbeTargetsPageAsync(afterId, ProberOptions.PageSize, cancellationToken);
            },
            processPage: targets => ProberCycle.ProbeAndReportPageAsync(
                targets,
                _probe!.ProbeAsync,
                _options.Concurrency,
                report: async results =>
                {
                    using var scope = _scopes.CreateScope();
                    var ingest = scope.ServiceProvider.GetRequiredService<IngestService>();
                    foreach (var (organizationId, checks) in ProberCycle.GroupChecksByOrg(results))
                    {
                        try
                        {
                            await ingest.IngestBatchAsync(
                                organizationId, checks, [], sourceOverride: "prober", cancellationToken);
                        }
                        catch (ApiException exception)
                        {
                            // A device deleted between the page query and the write fails its
                            // org's batch (ORG_008); the other orgs in the drain still report.
                            Log.PageReportFailed(_logger, organizationId, exception);
                        }
                    }
                },
                cancellationToken),
            cancellationToken);

    private static partial class Log
    {
        [LoggerMessage(
            Level = LogLevel.Information,
            Message = "Embedded prober enabled (interval {IntervalMs}ms, concurrency {Concurrency})")]
        public static partial void Enabled(ILogger logger, int intervalMs, int concurrency);

        [LoggerMessage(
            Level = LogLevel.Warning,
            Message = "probe cycle still running when the next tick fired - skipping it "
                + "(skippedTicks {SkippedTicks}, intervalMs {IntervalMs}). The fleet no longer fits in "
                + "MONITORING_PROBE_INTERVAL_MS; raise the interval or the concurrency.")]
        public static partial void TickSkipped(ILogger logger, int skippedTicks, int intervalMs);

        [LoggerMessage(Level = LogLevel.Warning, Message = "probe cycle failed")]
        public static partial void CycleFailed(ILogger logger, Exception exception);

        [LoggerMessage(
            Level = LogLevel.Warning,
            Message = "probe batch for org {OrganizationId} failed; other orgs in the page still reported")]
        public static partial void PageReportFailed(ILogger logger, string organizationId, Exception exception);

        [LoggerMessage(Level = LogLevel.Error, Message = "{Message}")]
        public static partial void IcmpUnavailable(ILogger logger, string message);
    }
}
