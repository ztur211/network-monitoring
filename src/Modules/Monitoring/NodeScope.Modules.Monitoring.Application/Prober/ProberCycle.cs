using NodeScope.Modules.Monitoring.Application.Ingest;

namespace NodeScope.Modules.Monitoring.Application.Prober;

/// <summary>A device the prober will probe: the whole selection is "has an IP address".</summary>
public sealed record ProbeTarget(string Id, string OrganizationId, string IpAddress);

/// <summary>One probe's outcome for one device.</summary>
public sealed record ProbeOutcome(bool Ok, double? LatencyMs);

/// <summary>A probed device paired with its result, ready for ingest.</summary>
public sealed record ProbedDevice(ProbeTarget Target, ProbeOutcome Outcome);

/// <summary>
/// The pure orchestration of one probe cycle (Node's <c>cycle()</c> + <c>runProbeCycle</c>),
/// kept free of timers and DI so the paging and concurrency behavior is unit-testable the way
/// the Node specs tested it. The hosted service supplies the page fetcher (a scoped repository
/// call), the probe function, and the reporter.
/// </summary>
public static class ProberCycle
{
    /// <summary>
    /// Keyset-paginates the fleet: fetch a page after <c>afterId</c>, process it, stop on an
    /// empty or short page. Never holds more than one page in memory - a 50k-device fleet must
    /// not materialize into a list (the resource-runaway class of bug this prober had once).
    /// </summary>
    public static async Task RunAsync(
        Func<string?, Task<IReadOnlyList<ProbeTarget>>> fetchPage,
        Func<IReadOnlyList<ProbeTarget>, Task> processPage,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(fetchPage);
        ArgumentNullException.ThrowIfNull(processPage);

        string? afterId = null;
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var page = await fetchPage(afterId);
            if (page.Count == 0)
            {
                return;
            }

            await processPage(page);
            if (page.Count < ProberOptions.PageSize)
            {
                return;
            }

            afterId = page[^1].Id;
        }
    }

    /// <summary>
    /// Probes one page with bounded concurrency (Node's <c>mapLimit</c>) and streams results
    /// to <paramref name="report"/> as they arrive: probes push into a channel, and a single
    /// consumer drains whatever has accumulated while the previous write was in flight.
    /// Node reported each device the moment its probe finished; a page-sized all-down fleet
    /// pays <c>pageSize/concurrency x timeout</c> before a page-batched write would land its
    /// FIRST row - minutes of stale statuses exactly when the fleet is down. The drain keeps
    /// Node's freshness while still batching writes (and keeps the scoped DbContext
    /// single-threaded, which per-probe reporting from the workers would not).
    /// </summary>
    public static async Task ProbeAndReportPageAsync(
        IReadOnlyList<ProbeTarget> targets,
        Func<string, CancellationToken, Task<ProbeOutcome>> probe,
        int concurrency,
        Func<IReadOnlyList<ProbedDevice>, Task> report,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(targets);
        ArgumentNullException.ThrowIfNull(probe);
        ArgumentNullException.ThrowIfNull(report);

        var channel = System.Threading.Channels.Channel.CreateUnbounded<ProbedDevice>(
            new System.Threading.Channels.UnboundedChannelOptions { SingleReader = true });

        async Task ProduceAsync()
        {
            try
            {
                await Parallel.ForAsync(
                    0,
                    targets.Count,
                    new ParallelOptions { MaxDegreeOfParallelism = concurrency, CancellationToken = cancellationToken },
                    async (index, token) =>
                    {
                        var target = targets[index];
                        channel.Writer.TryWrite(new ProbedDevice(target, await probe(target.IpAddress, token)));
                    });
            }
            finally
            {
                channel.Writer.Complete();
            }
        }

        var producer = ProduceAsync();
        var buffer = new List<ProbedDevice>();
        while (await channel.Reader.WaitToReadAsync(cancellationToken))
        {
            buffer.Clear();
            while (channel.Reader.TryRead(out var item))
            {
                buffer.Add(item);
            }

            await report([.. buffer]);
        }

        await producer;
    }

    /// <summary>
    /// Partitions a page's results into per-org ingest batches (the C# write path is set-based
    /// where Node reported per device; identical rows, events, and emits - the batch is
    /// documented as "same semantics as N 1-check calls"). Orgs keep first-seen order.
    /// </summary>
    public static IReadOnlyList<(string OrganizationId, IReadOnlyList<StatusCheckItem> Checks)> GroupChecksByOrg(
        IReadOnlyList<ProbedDevice> results)
    {
        ArgumentNullException.ThrowIfNull(results);

        var byOrg = new Dictionary<string, List<StatusCheckItem>>(StringComparer.Ordinal);
        var order = new List<string>();
        foreach (var probed in results)
        {
            if (!byOrg.TryGetValue(probed.Target.OrganizationId, out var checks))
            {
                checks = [];
                byOrg[probed.Target.OrganizationId] = checks;
                order.Add(probed.Target.OrganizationId);
            }

            checks.Add(new StatusCheckItem
            {
                DeviceId = probed.Target.Id,
                Ok = probed.Outcome.Ok,
                LatencyMs = probed.Outcome.LatencyMs,
            });
        }

        return [.. order.Select(org =>
            (org, (IReadOnlyList<StatusCheckItem>)byOrg[org]))];
    }
}

/// <summary>
/// Node's <c>nonOverlapping</c> wrapper as a primitive: a tick that fires while the previous
/// cycle still runs is DROPPED (never queued), and the drop is counted. This guard is what
/// keeps a fleet that outgrew its interval from piling up cycles until the container dies -
/// the historical resource-runaway bug, proven contained by watching these skips in the logs.
/// </summary>
public sealed class ProberTickGuard
{
    private int _running;
    private int _skipped;

    /// <summary>Total ticks dropped so far.</summary>
    public int SkippedTicks => Volatile.Read(ref _skipped);

    /// <summary>True when the cycle may run; false means a cycle is already in flight.</summary>
    public bool TryEnter() => Interlocked.CompareExchange(ref _running, 1, 0) == 0;

    /// <summary>Records a dropped tick and returns the running total.</summary>
    public int RecordSkip() => Interlocked.Increment(ref _skipped);

    /// <summary>Releases the guard; call from a finally so a thrown cycle cannot wedge it.</summary>
    public void Exit() => Volatile.Write(ref _running, 0);
}
