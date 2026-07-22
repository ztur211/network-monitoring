using NodeScope.Contracts.Monitoring;

namespace NodeScope.Agent;

/// <summary>A minimal SNMP session abstraction used by <see cref="SnmpCollector"/> (real or fake).</summary>
internal interface ISnmpSession : IDisposable
{
    /// <summary>GET a set of scalar OIDs; returns a map of oid to numeric value. Non-numeric varbinds are skipped.</summary>
    public Task<IReadOnlyDictionary<string, double>> GetAsync(IReadOnlyList<string> oids, CancellationToken cancellationToken);

    /// <summary>Walk a single column OID; returns a map of ifIndex (as string) to numeric value.</summary>
    public Task<IReadOnlyDictionary<string, double>> WalkColumnAsync(string oid, CancellationToken cancellationToken);
}

/// <summary>Produces an <see cref="ISnmpSession"/> for a target descriptor; host is the device IP.</summary>
internal delegate ISnmpSession SnmpSessionFactory(SnmpTargetDto target, string host);

/// <summary>
/// For each device that has an SNMP target descriptor, opens a session and:
///  - GETs sysUpTime, emitted as <c>sys_uptime</c> (ticks / 100 = seconds)
///  - GETs each custom OID, emitted under the entry's metric label
///  - if interface metrics are enabled, walks ifHCInOctets / ifHCOutOctets / ifOperStatus
///    and emits per-ifIndex metrics (<c>if_hc_in_octets.&lt;idx&gt;</c> etc.)
///
/// Devices without SNMP are silently skipped. Any per-device SNMP error (including a
/// factory that throws) yields an empty result rather than failing the cycle - one broken
/// or unreachable device must not cost the rest of the fleet its samples. The session is
/// always disposed.
/// </summary>
internal sealed class SnmpCollector(SnmpSessionFactory factory) : ICollector
{
    /// <summary>SNMPv2-MIB::sysUpTime.0 - in hundredths of a second.</summary>
    internal const string SysUptime = "1.3.6.1.2.1.1.3.0";

    /// <summary>IF-MIB::ifHCInOctets (64-bit column) - ifXTable column 6.</summary>
    internal const string IfHcInOctets = "1.3.6.1.2.1.31.1.1.1.6";

    /// <summary>IF-MIB::ifHCOutOctets (64-bit column) - ifXTable column 10.</summary>
    internal const string IfHcOutOctets = "1.3.6.1.2.1.31.1.1.1.10";

    /// <summary>IF-MIB::ifOperStatus (ifTable column 8).</summary>
    internal const string IfOperStatus = "1.3.6.1.2.1.2.2.1.8";

    public async Task<CollectResult> CollectAsync(AgentDeviceDto device, CancellationToken cancellationToken)
    {
        if (device.Snmp is null)
        {
            return CollectResult.Empty;
        }

        var target = device.Snmp;
        ISnmpSession? session = null;
        try
        {
            session = factory(target, device.IpAddress);
            var metrics = new List<MetricSampleDto>();

            var scalarOids = new List<string> { SysUptime };
            foreach (var entry in target.Oids)
            {
                scalarOids.Add(entry.Oid);
            }

            var scalars = await session.GetAsync(scalarOids, cancellationToken);

            if (scalars.TryGetValue(SysUptime, out var uptimeTicks))
            {
                metrics.Add(new MetricSampleDto { DeviceId = device.Id, Metric = "sys_uptime", Value = uptimeTicks / 100 });
            }

            foreach (var entry in target.Oids)
            {
                if (scalars.TryGetValue(entry.Oid, out var value))
                {
                    metrics.Add(new MetricSampleDto { DeviceId = device.Id, Metric = entry.Metric, Value = value });
                }
            }

            if (target.InterfaceMetrics)
            {
                var inOctetsTask = session.WalkColumnAsync(IfHcInOctets, cancellationToken);
                var outOctetsTask = session.WalkColumnAsync(IfHcOutOctets, cancellationToken);
                var operStatusTask = session.WalkColumnAsync(IfOperStatus, cancellationToken);
                await Task.WhenAll(inOctetsTask, outOctetsTask, operStatusTask);

                AddColumn(metrics, device.Id, "if_hc_in_octets", await inOctetsTask);
                AddColumn(metrics, device.Id, "if_hc_out_octets", await outOctetsTask);
                AddColumn(metrics, device.Id, "if_oper_status", await operStatusTask);
            }

            return new CollectResult([], metrics);
        }
#pragma warning disable CA1031 // Per-device fault isolation: any SNMP failure must yield an empty result, never sink the cycle.
        catch (Exception)
#pragma warning restore CA1031
        {
            return CollectResult.Empty;
        }
        finally
        {
            session?.Dispose();
        }
    }

    private static void AddColumn(
        List<MetricSampleDto> metrics, string deviceId, string prefix, IReadOnlyDictionary<string, double> column)
    {
        foreach (var (index, value) in column)
        {
            metrics.Add(new MetricSampleDto { DeviceId = deviceId, Metric = $"{prefix}.{index}", Value = value });
        }
    }
}
