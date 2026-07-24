using NodeScope.Modules.Monitoring.Application.Prober;
using Xunit;

namespace NodeScope.Monitoring.Tests;

/// <summary>
/// Ports of the Node paging/overlap/concurrency specs. The paging tests assert the same
/// properties: every device probed exactly once across page boundaries, never more than one
/// page fetched ahead, and a stop on an empty or short page.
/// </summary>
public sealed class ProberCycleTests
{
    private static IReadOnlyList<ProbeTarget> Fleet(int count) =>
        [.. Enumerable.Range(0, count)
            .Select(i => new ProbeTarget($"dev-{i:D6}", "org-1", $"10.{i / 65536}.{i / 256 % 256}.{i % 256}"))];

    private static Func<string?, Task<IReadOnlyList<ProbeTarget>>> Pager(
        IReadOnlyList<ProbeTarget> fleet, List<string?> cursors)
    {
        return afterId =>
        {
            cursors.Add(afterId);
            IReadOnlyList<ProbeTarget> page = [.. fleet
                .Where(d => afterId is null || string.CompareOrdinal(d.Id, afterId) > 0)
                .OrderBy(d => d.Id, StringComparer.Ordinal)
                .Take(ProberOptions.PageSize)];
            return Task.FromResult(page);
        };
    }

    [Fact]
    public async Task Paging_probes_every_device_exactly_once_across_page_boundaries()
    {
        var fleet = Fleet(1200);
        var cursors = new List<string?>();
        var processed = new List<IReadOnlyList<ProbeTarget>>();

        await ProberCycle.RunAsync(
            Pager(fleet, cursors),
            page => { processed.Add(page); return Task.CompletedTask; },
            CancellationToken.None);

        Assert.Equal([500, 500, 200], processed.Select(p => p.Count));
        var seen = processed.SelectMany(p => p).Select(d => d.Id).ToList();
        Assert.Equal(fleet.Count, seen.Count);
        Assert.Equal(fleet.Count, seen.Distinct(StringComparer.Ordinal).Count());
        // The short final page ends the cycle: three fetches, not a fourth empty probe.
        Assert.Equal(3, cursors.Count);
    }

    [Fact]
    public async Task Paging_on_an_exact_page_multiple_stops_on_the_empty_follow_up()
    {
        var fleet = Fleet(500);
        var cursors = new List<string?>();
        var processedPages = 0;

        await ProberCycle.RunAsync(
            Pager(fleet, cursors),
            _ => { processedPages++; return Task.CompletedTask; },
            CancellationToken.None);

        // A full page cannot prove the fleet is exhausted, so one more (empty) fetch happens,
        // and the empty page is never processed.
        Assert.Equal(2, cursors.Count);
        Assert.Equal(1, processedPages);
    }

    [Fact]
    public async Task Paging_with_no_devices_fetches_once_and_processes_nothing()
    {
        var cursors = new List<string?>();
        var processedPages = 0;

        await ProberCycle.RunAsync(
            Pager([], cursors),
            _ => { processedPages++; return Task.CompletedTask; },
            CancellationToken.None);

        Assert.Single(cursors);
        Assert.Equal(0, processedPages);
    }

    [Fact]
    public async Task ProbeAndReport_reports_every_device_exactly_once_and_respects_the_concurrency_cap()
    {
        var fleet = Fleet(100);
        var inFlight = 0;
        var maxInFlight = 0;
        var reported = new List<ProbedDevice>();
        var batches = 0;

        await ProberCycle.ProbeAndReportPageAsync(
            fleet,
            async (ip, ct) =>
            {
                var now = Interlocked.Increment(ref inFlight);
                InterlockedMax(ref maxInFlight, now);
                await Task.Delay(10, ct);
                Interlocked.Decrement(ref inFlight);
                return new ProbeOutcome(false, null);
            },
            concurrency: 5,
            report: batch =>
            {
                batches++;
                Assert.NotEmpty(batch);
                reported.AddRange(batch);
                return Task.CompletedTask;
            },
            CancellationToken.None);

        Assert.InRange(maxInFlight, 2, 5);
        Assert.Equal(fleet.Count, reported.Count);
        Assert.Equal(
            fleet.Select(d => d.Id).Order(StringComparer.Ordinal),
            reported.Select(r => r.Target.Id).Order(StringComparer.Ordinal));
        // Streaming, not one page-sized batch: results drain while later probes still run.
        Assert.True(batches > 1, $"expected incremental drains, got {batches} batch(es)");
    }

    [Fact]
    public async Task ProbeAndReport_associates_each_outcome_with_its_device()
    {
        IReadOnlyList<ProbeTarget> targets =
            [new("a", "org-1", "10.0.0.1"), new("b", "org-1", "10.0.0.2")];
        var reported = new List<ProbedDevice>();

        await ProberCycle.ProbeAndReportPageAsync(
            targets,
            (ip, _) => Task.FromResult(new ProbeOutcome(ip == "10.0.0.1", ip == "10.0.0.1" ? 12.5 : null)),
            concurrency: 2,
            report: batch => { reported.AddRange(batch); return Task.CompletedTask; },
            CancellationToken.None);

        Assert.True(reported.Single(r => r.Target.Id == "a").Outcome.Ok);
        Assert.Equal(12.5, reported.Single(r => r.Target.Id == "a").Outcome.LatencyMs);
        Assert.False(reported.Single(r => r.Target.Id == "b").Outcome.Ok);
    }

    [Fact]
    public async Task ProbeAndReport_still_reports_completed_probes_when_a_later_probe_throws()
    {
        var fleet = Fleet(20);
        var poisonIp = fleet[^1].IpAddress;
        var reported = new List<ProbedDevice>();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            ProberCycle.ProbeAndReportPageAsync(
                fleet,
                async (ip, ct) =>
                {
                    await Task.Delay(1, ct);
                    return ip == poisonIp
                        ? throw new InvalidOperationException("probe blew up")
                        : new ProbeOutcome(false, null);
                },
                concurrency: 1,
                report: batch => { reported.AddRange(batch); return Task.CompletedTask; },
                CancellationToken.None));

        // Probes before the failure drained and reported; the fault still surfaces to the
        // cycle (where the hosted service logs it) instead of vanishing.
        Assert.NotEmpty(reported);
    }

    [Fact]
    public void GroupChecksByOrg_partitions_by_org_in_first_seen_order()
    {
        IReadOnlyList<ProbedDevice> results =
        [
            new(new ProbeTarget("d1", "org-b", "x"), new ProbeOutcome(true, 5)),
            new(new ProbeTarget("d2", "org-a", "x"), new ProbeOutcome(false, null)),
            new(new ProbeTarget("d3", "org-b", "x"), new ProbeOutcome(false, null)),
        ];

        var groups = ProberCycle.GroupChecksByOrg(results);

        Assert.Equal(["org-b", "org-a"], groups.Select(g => g.OrganizationId));
        var orgB = groups[0].Checks;
        Assert.Equal(["d1", "d3"], orgB.Select(c => c.DeviceId));
        Assert.True(orgB[0].Ok);
        Assert.Equal(5, orgB[0].LatencyMs);
        Assert.False(orgB[1].Ok);
        Assert.Null(orgB[1].LatencyMs);
    }

    [Fact]
    public async Task Guard_drops_a_tick_while_a_cycle_runs_and_recovers_after_exit()
    {
        var guard = new ProberTickGuard();

        Assert.True(guard.TryEnter());
        Assert.False(guard.TryEnter());
        Assert.Equal(1, guard.RecordSkip());
        Assert.Equal(2, guard.RecordSkip());
        guard.Exit();
        Assert.True(guard.TryEnter());
        guard.Exit();
        Assert.Equal(2, guard.SkippedTicks);

        // Concurrent entry: exactly one winner (the containment property itself).
        var winners = 0;
        await Task.WhenAll(Enumerable.Range(0, 32).Select(_ => Task.Run(() =>
        {
            if (guard.TryEnter())
            {
                Interlocked.Increment(ref winners);
            }
        })));
        Assert.Equal(1, winners);
    }

    [Fact]
    public async Task Guard_releases_after_a_thrown_cycle_so_the_next_tick_still_fires()
    {
        var guard = new ProberTickGuard();

        Assert.True(guard.TryEnter());
        try
        {
            await Task.FromException(new InvalidOperationException("cycle blew up"));
        }
        catch (InvalidOperationException)
        {
            // The hosted service releases in a finally; mirror that here.
        }
        finally
        {
            guard.Exit();
        }

        Assert.True(guard.TryEnter());
    }

    private static void InterlockedMax(ref int location, int value)
    {
        int current;
        while (value > (current = Volatile.Read(ref location)))
        {
            if (Interlocked.CompareExchange(ref location, value, current) == current)
            {
                return;
            }
        }
    }
}
