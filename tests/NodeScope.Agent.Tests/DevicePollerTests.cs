using System.Net;
using System.Net.Sockets;
using NodeScope.Agent;
using NodeScope.Contracts.Monitoring;
using Xunit;
using static NodeScope.Agent.Tests.TestData;

namespace NodeScope.Agent.Tests;

public class DevicePollerTests
{
    private static Task<ProbeResult> Probe(string ip, CancellationToken ct) =>
        Task.FromResult(ip == "10.0.0.1" ? new ProbeResult(true, 7) : new ProbeResult(false));

    [Fact]
    public async Task Reachability_collector_emits_a_check_plus_latency_metric()
    {
        var result = await new ReachabilityCollector(Probe)
            .CollectAsync(Device("a", "10.0.0.1"), CancellationToken.None);

        var check = Assert.Single(result.Checks);
        Assert.Equal(("a", true, 7d), (check.DeviceId, check.Ok, check.LatencyMs));
        var metric = Assert.Single(result.Metrics);
        Assert.Equal(("a", "latency_ms", 7d), (metric.DeviceId, metric.Metric, metric.Value));
    }

    [Fact]
    public async Task An_unmeasured_probe_emits_a_check_but_no_latency_metric()
    {
        var result = await new ReachabilityCollector(Probe)
            .CollectAsync(Device("b", "10.0.0.2"), CancellationToken.None);

        var check = Assert.Single(result.Checks);
        Assert.False(check.Ok);
        Assert.Null(check.LatencyMs);
        Assert.Empty(result.Metrics);
    }

    [Fact]
    public async Task PollDevices_merges_all_collectors_over_all_devices()
    {
        var devices = new List<AgentDeviceDto> { Device("a", "10.0.0.1"), Device("b", "10.0.0.2") };
        var batch = await DevicePoller.PollAsync(
            devices, [new ReachabilityCollector(Probe)], concurrency: 2, CancellationToken.None);

        Assert.Equal(["a", "b"], batch.Checks!.Select(c => c.DeviceId).Order());
        Assert.False(batch.Checks!.Single(c => c.DeviceId == "b").Ok);
    }

    [Fact]
    public async Task Concurrency_is_bounded()
    {
        var devices = Enumerable.Range(0, 20).Select(i => Device($"d{i}", "10.0.0.1")).ToList();
        var inFlight = 0;
        var peak = 0;
        var gate = new object();

        var collector = new ReachabilityCollector(async (_, token) =>
        {
            lock (gate)
            {
                inFlight++;
                peak = Math.Max(peak, inFlight);
            }

            await Task.Delay(10, token);
            lock (gate)
            {
                inFlight--;
            }

            return new ProbeResult(true, 1);
        });

        await DevicePoller.PollAsync(devices, [collector], concurrency: 3, CancellationToken.None);
        Assert.InRange(peak, 1, 3);
    }
}

public class DeviceProberTests
{
    [Fact]
    public async Task Tcp_probe_succeeds_against_a_listening_port_and_measures_latency()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;

        var prober = new DeviceProber(icmpEnabled: false, ports: [port], timeoutMs: 2000);
        var result = await prober.ProbeAsync("127.0.0.1", CancellationToken.None);

        Assert.True(result.Ok);
        Assert.NotNull(result.LatencyMs);
    }

    [Fact]
    public async Task Tcp_probe_fails_fast_against_a_closed_port()
    {
        // Bind-then-close to get a port that is definitely not listening.
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();

        var prober = new DeviceProber(icmpEnabled: false, ports: [port], timeoutMs: 2000);
        var result = await prober.ProbeAsync("127.0.0.1", CancellationToken.None);
        Assert.False(result.Ok);
    }

    [Fact]
    public async Task No_ports_and_no_icmp_is_unreachable()
    {
        var prober = new DeviceProber(icmpEnabled: false, ports: [], timeoutMs: 100);
        var result = await prober.ProbeAsync("127.0.0.1", CancellationToken.None);
        Assert.False(result.Ok);
    }

    [Fact]
    public async Task An_unparseable_ip_is_unreachable_not_an_exception()
    {
        var prober = new DeviceProber(icmpEnabled: true, ports: [443], timeoutMs: 100);
        var result = await prober.ProbeAsync("not-an-ip", CancellationToken.None);
        Assert.False(result.Ok);
    }
}
