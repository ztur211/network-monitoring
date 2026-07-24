using System.ComponentModel;
using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using NodeScope.Modules.Monitoring.Application.Prober;

namespace NodeScope.Modules.Monitoring.Infrastructure.Prober;

/// <summary>
/// Device reachability for the embedded prober: ICMP first (if enabled), then TCP-connect
/// racing the port set; reachable if any succeeds. Behaviorally identical to the agent's
/// <c>DeviceProber</c> (both descend from <c>packages/probe</c>) but owned by this module -
/// the agent is a separate executable the module boundary cannot reference.
/// </summary>
/// <remarks>
/// ICMP uses <see cref="Ping"/>, which on Linux without CAP_NET_RAW either opens an
/// unprivileged ICMP socket (when net.ipv4.ping_group_range allows) or falls back to
/// spawning the system <c>ping</c>. A host where neither works is a broken DEPLOYMENT,
/// not a dead device - conflating the two is how a monitoring product invents outages
/// (every ICMP-only device would read DOWN). So that condition is latched once per
/// process, reported once through <paramref name="onIcmpUnavailable"/>, and subsequent
/// probes skip straight to TCP.
/// </remarks>
internal sealed class ReachabilityProbe(
    bool icmpEnabled, IReadOnlyList<int> ports, int timeoutMs, Action<string> onIcmpUnavailable)
{
    private bool _icmpUnavailable;

    public async Task<ProbeOutcome> ProbeAsync(string ip, CancellationToken cancellationToken)
    {
        if (icmpEnabled)
        {
            var icmp = await IcmpProbeAsync(ip, cancellationToken);
            if (icmp.Ok)
            {
                return icmp;
            }
        }

        if (ports.Count == 0)
        {
            return new ProbeOutcome(false, null);
        }

        // Race the TCP ports concurrently: resolve on the FIRST successful connect, or once
        // every port has failed. Trying ports serially made a down device pay
        // ports.Count x timeoutMs while holding a concurrency slot; racing bounds it to ~1x.
        var tasks = ports.Select(port => TcpProbeAsync(ip, port, cancellationToken)).ToList();
        while (tasks.Count > 0)
        {
            var done = await Task.WhenAny(tasks);
            tasks.Remove(done);
            var result = await done;
            if (result.Ok)
            {
                return result;
            }
        }

        return new ProbeOutcome(false, null);
    }

    /// <summary>TCP-connect reachability: a completed handshake = reachable. No data is sent.</summary>
    private async Task<ProbeOutcome> TcpProbeAsync(string ip, int port, CancellationToken cancellationToken)
    {
        if (!IPAddress.TryParse(ip, out var address))
        {
            return new ProbeOutcome(false, null);
        }

        using var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(timeoutMs);
        var started = Stopwatch.GetTimestamp();
        try
        {
            await socket.ConnectAsync(address, port, cts.Token);
            return new ProbeOutcome(true, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
        }
        catch (OperationCanceledException)
        {
            return new ProbeOutcome(false, null);
        }
        catch (SocketException)
        {
            return new ProbeOutcome(false, null);
        }
    }

    private async Task<ProbeOutcome> IcmpProbeAsync(string ip, CancellationToken cancellationToken)
    {
        if (_icmpUnavailable)
        {
            return new ProbeOutcome(false, null);
        }

        if (!IPAddress.TryParse(ip, out var address))
        {
            return new ProbeOutcome(false, null);
        }

        try
        {
            using var ping = new Ping();
            var reply = await ping.SendPingAsync(
                address, TimeSpan.FromMilliseconds(timeoutMs), cancellationToken: cancellationToken);
            return reply.Status == IPStatus.Success
                ? new ProbeOutcome(true, reply.RoundtripTime)
                : new ProbeOutcome(false, null);
        }
        catch (Exception e) when (IsIcmpImpossible(e))
        {
            if (!_icmpUnavailable)
            {
                _icmpUnavailable = true;
                onIcmpUnavailable(
                    "ICMP probing is DISABLED: this host can neither open an ICMP socket nor spawn "
                    + "`ping` (install iputils-ping, or set MONITORING_ICMP_ENABLED=false to silence "
                    + "this). Probes now fall back to TCP only, so a device that answers ping but "
                    + "exposes no probed port reads as DOWN.");
            }

            return new ProbeOutcome(false, null);
        }
        catch (PingException)
        {
            return new ProbeOutcome(false, null);
        }
        catch (OperationCanceledException)
        {
            return new ProbeOutcome(false, null);
        }
    }

    /// <summary>
    /// True when the failure means ICMP can never work on this host (no ping binary, no
    /// permitted ICMP socket), as opposed to this one probe failing.
    /// </summary>
    private static bool IsIcmpImpossible(Exception e)
    {
        for (Exception? current = e; current is not null; current = current.InnerException)
        {
            if (current is PlatformNotSupportedException)
            {
                return true;
            }

            // ENOENT from spawning `ping`: there is no binary to spawn.
            if (current is Win32Exception { NativeErrorCode: 2 })
            {
                return true;
            }
        }

        return false;
    }
}
