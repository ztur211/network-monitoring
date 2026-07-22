using NodeScope.Agent;
using NodeScope.Contracts.Monitoring;
using Xunit;
using static NodeScope.Agent.Tests.TestData;

namespace NodeScope.Agent.Tests;

public class SnmpCollectorTests
{
    private static SnmpTargetDto V2C(IReadOnlyList<SnmpOidEntry>? oids = null, bool interfaceMetrics = false) =>
        new() { Version = "V2C", Community = "public", Oids = oids ?? [], InterfaceMetrics = interfaceMetrics };

    [Fact]
    public async Task Returns_empty_result_for_device_with_no_snmp_property()
    {
        var factoryCalls = 0;
        var collector = new SnmpCollector((_, _) =>
        {
            factoryCalls++;
            return new FakeSnmpSession();
        });

        var result = await collector.CollectAsync(Device("dev1", "10.0.0.1"), CancellationToken.None);

        Assert.Empty(result.Checks);
        Assert.Empty(result.Metrics);
        Assert.Equal(0, factoryCalls);
    }

    [Fact]
    public async Task Emits_sys_uptime_custom_oid_metrics_and_per_interface_metrics()
    {
        var device = Device("dev2", "10.0.0.2", V2C(
            oids: [new SnmpOidEntry { Oid = "1.3.6.1.2.1.1.1.0", Metric = "sys_descr" }],
            interfaceMetrics: true));

        // sysUpTime = 36000 hundredths -> 360 seconds; custom oid = 42
        var walkResults = new Queue<Dictionary<string, double>>([
            new() { ["1"] = 1_000_000, ["2"] = 2_000_000 },
            new() { ["1"] = 500_000, ["2"] = 750_000 },
            new() { ["1"] = 1, ["2"] = 2 },
        ]);
        using var session = new FakeSnmpSession
        {
            OnGet = _ => Task.FromResult<IReadOnlyDictionary<string, double>>(new Dictionary<string, double>
            {
                [SnmpCollector.SysUptime] = 36_000,
                ["1.3.6.1.2.1.1.1.0"] = 42,
            }),
            OnWalk = _ => Task.FromResult<IReadOnlyDictionary<string, double>>(walkResults.Dequeue()),
        };

        var result = await new SnmpCollector((_, _) => session).CollectAsync(device, CancellationToken.None);

        // --- session interactions ---
        Assert.Equal(1, session.DisposeCount);
        Assert.Equal([SnmpCollector.SysUptime, "1.3.6.1.2.1.1.1.0"], session.GetCalls.Single());
        Assert.Equal(
            [SnmpCollector.IfHcInOctets, SnmpCollector.IfHcOutOctets, SnmpCollector.IfOperStatus],
            session.WalkCalls);

        // --- emitted metrics ---
        double Value(string metric) => result.Metrics.Single(m => m.Metric == metric).Value;

        Assert.Equal(360, Value("sys_uptime")); // 36000 / 100
        Assert.Equal(42, Value("sys_descr"));
        Assert.Equal(1_000_000, Value("if_hc_in_octets.1"));
        Assert.Equal(500_000, Value("if_hc_out_octets.1"));
        Assert.Equal(1, Value("if_oper_status.1"));
        Assert.Equal(2_000_000, Value("if_hc_in_octets.2"));
        Assert.Equal(750_000, Value("if_hc_out_octets.2"));
        Assert.Equal(2, Value("if_oper_status.2"));

        Assert.Empty(result.Checks);
        Assert.Equal(8, result.Metrics.Count); // 1 sys_uptime + 1 custom + 3 * 2 interfaces
    }

    [Fact]
    public async Task Returns_empty_result_and_does_not_throw_when_session_throws()
    {
        using var session = new FakeSnmpSession
        {
            OnGet = _ => throw new TimeoutException("SNMP timeout"),
        };

        var result = await new SnmpCollector((_, _) => session)
            .CollectAsync(Device("dev3", "10.0.0.3", V2C()), CancellationToken.None);

        Assert.Empty(result.Checks);
        Assert.Empty(result.Metrics);
        // Dispose must still run even after an error (finally block)
        Assert.Equal(1, session.DisposeCount);
    }

    [Fact]
    public async Task A_session_factory_that_throws_synchronously_yields_empty()
    {
        var collector = new SnmpCollector((_, _) => throw new InvalidOperationException("createSession failed"));
        var device = Device(snmp: V2C(oids: [new SnmpOidEntry { Oid = "1", Metric = "m" }]));

        var result = await collector.CollectAsync(device, CancellationToken.None);

        Assert.Empty(result.Checks);
        Assert.Empty(result.Metrics);
    }
}
