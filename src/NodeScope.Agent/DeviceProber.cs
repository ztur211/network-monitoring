using System.ComponentModel;
using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace NodeScope.Agent;

internal readonly record struct ProbeResult(bool Ok, double? LatencyMs = null, bool IcmpUnavailable = false);

/// <summary>
/// Device reachability: ICMP first (if enabled), then TCP-connect over the port set;
/// reachable if any succeeds.
/// </summary>
/// <remarks>
/// ICMP uses <see cref="Ping"/>, which on Linux without CAP_NET_RAW either opens an
/// unprivileged ICMP socket (when net.ipv4.ping_group_range allows) or falls back to
/// spawning the system <c>ping</c>. A host where neither works is a broken DEPLOYMENT,
/// not a dead device - conflating the two is how a monitoring product invents outages
/// (every ICMP-only device would read DOWN). So that condition is latched once per
/// process, reported once, and subsequent probes skip straight to TCP.
/// </remarks>
internal sealed class DeviceProber(bool icmpEnabled, IReadOnlyList<int> ports, int timeoutMs, Action<string>? onIcmpUnavailable = null)
{
    private readonly Action<string> _onIcmpUnavailable =
        onIcmpUnavailable ?? (static message => Console.Error.WriteLine($"[probe] {message}"));

    private bool _icmpUnavailable;

    public async Task<ProbeResult> ProbeAsync(string ip, CancellationToken cancellationToken)
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
            return new ProbeResult(false);
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

        return new ProbeResult(false);
    }

    /// <summary>TCP-connect reachability: a completed handshake = reachable. No data is sent.</summary>
    internal async Task<ProbeResult> TcpProbeAsync(string ip, int port, CancellationToken cancellationToken)
    {
        if (!IPAddress.TryParse(ip, out var address))
        {
            return new ProbeResult(false);
        }

        using var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(timeoutMs);
        var started = Stopwatch.GetTimestamp();
        try
        {
            await socket.ConnectAsync(address, port, cts.Token);
            return new ProbeResult(true, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
        }
        catch (OperationCanceledException)
        {
            return new ProbeResult(false);
        }
        catch (SocketException)
        {
            return new ProbeResult(false);
        }
    }

    internal async Task<ProbeResult> IcmpProbeAsync(string ip, CancellationToken cancellationToken)
    {
        if (_icmpUnavailable)
        {
            return new ProbeResult(false, IcmpUnavailable: true);
        }

        if (!IPAddress.TryParse(ip, out var address))
        {
            return new ProbeResult(false);
        }

        try
        {
            using var ping = new Ping();
            var reply = await ping.SendPingAsync(
                address, TimeSpan.FromMilliseconds(timeoutMs), cancellationToken: cancellationToken);
            return reply.Status == IPStatus.Success
                ? new ProbeResult(true, reply.RoundtripTime)
                : new ProbeResult(false);
        }
        catch (Exception e) when (IsIcmpImpossible(e))
        {
            if (!_icmpUnavailable)
            {
                _icmpUnavailable = true;
                _onIcmpUnavailable(
                    "ICMP probing is DISABLED: this host can neither open an ICMP socket nor spawn "
                    + "`ping` (install iputils-ping, or set NODESCOPE_AGENT_ICMP=false to silence "
                    + "this). Probes now fall back to TCP only, so a device that answers ping but "
                    + "exposes no probed port reads as DOWN.");
            }

            return new ProbeResult(false, IcmpUnavailable: true);
        }
        catch (PingException)
        {
            return new ProbeResult(false);
        }
        catch (OperationCanceledException)
        {
            return new ProbeResult(false);
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
