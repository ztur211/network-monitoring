using System.Globalization;

namespace NodeScope.Modules.Monitoring.Application.Prober;

/// <summary>
/// The embedded prober's knobs (Node's <c>prober.service.ts</c> <c>cfg()</c>). OFF by default:
/// a managed cloud deployment cannot reach a customer LAN, so probing from the server is only
/// correct when the appliance sits on the monitored network - which the local-first design
/// makes the primary topology, so self-host deploys turn it on.
/// </summary>
public sealed record ProberOptions(
    bool Enabled,
    int IntervalMs,
    int Concurrency,
    bool IcmpEnabled,
    IReadOnlyList<int> Ports,
    int TimeoutMs)
{
    /// <summary>Keyset page size for the device scan (hardcoded in Node too).</summary>
    public const int PageSize = 500;

    private static readonly int[] DefaultPorts = [443, 80, 22];

    /// <summary>
    /// Reads the same env vars with Node's <c>envInt</c> semantics: empty/invalid and
    /// below-minimum values fall back to the DEFAULT (not the bound), above-maximum clamps.
    /// <c>MONITORING_PROBER_ENABLED</c> must be the literal <c>true</c>;
    /// <c>MONITORING_ICMP_ENABLED</c> only the literal <c>false</c> disables.
    /// </summary>
    public static ProberOptions FromEnvironment(Func<string, string?> env)
    {
        ArgumentNullException.ThrowIfNull(env);
        return new ProberOptions(
            Enabled: env("MONITORING_PROBER_ENABLED") == "true",
            IntervalMs: BoundedInt(env("MONITORING_PROBE_INTERVAL_MS"), fallback: 30_000, min: 1000, max: null),
            Concurrency: BoundedInt(env("MONITORING_PROBE_CONCURRENCY"), fallback: 20, min: 1, max: 500),
            IcmpEnabled: env("MONITORING_ICMP_ENABLED") != "false",
            Ports: ParsePorts(env("MONITORING_PROBE_PORTS")),
            TimeoutMs: BoundedInt(env("MONITORING_PROBE_TIMEOUT_MS"), fallback: 2000, min: 100, max: null));
    }

    /// <summary>Comma-separated port list; entries outside 1-65535 or non-integer are dropped.</summary>
    public static IReadOnlyList<int> ParsePorts(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return DefaultPorts;
        }

        return [.. raw.Split(',')
            .Select(part => part.Trim())
            .Select(part =>
                int.TryParse(part, NumberStyles.None, CultureInfo.InvariantCulture, out var port) ? port : 0)
            .Where(port => port is >= 1 and <= 65_535)];
    }

    private static int BoundedInt(string? raw, int fallback, int min, int? max)
    {
        if (string.IsNullOrWhiteSpace(raw)
            || !int.TryParse(raw, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var value)
            || value < min)
        {
            return fallback;
        }

        return max is { } bound && value > bound ? bound : value;
    }
}
