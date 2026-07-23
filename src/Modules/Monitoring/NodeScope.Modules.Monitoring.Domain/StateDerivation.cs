namespace NodeScope.Modules.Monitoring.Domain;

/// <summary>The outcome of one status-check derivation.</summary>
public sealed record DerivedState(DeviceStatusState State, int ConsecutiveFails);

/// <summary>
/// Pure per-check state derivation, ported from <c>derive-state.ts</c> (spec §7).
/// <c>UNKNOWN</c> is never produced here - it is the read-side default for a device that has
/// no status row; this function covers checked devices only.
/// Anti-flap: a single failed check below the down threshold is a soft WARNING rather than a
/// hard DOWN, so one dropped packet does not flap the node.
/// </summary>
public static class StateDerivation
{
    public static DerivedState Derive(
        int previousConsecutiveFails,
        bool ok,
        double? latencyMs,
        int downThreshold,
        double warnLatencyMs)
    {
        if (ok)
        {
            var slow = (latencyMs ?? 0) > warnLatencyMs;
            return new DerivedState(slow ? DeviceStatusState.Warning : DeviceStatusState.Up, 0);
        }

        var consecutiveFails = previousConsecutiveFails + 1;
        return new DerivedState(
            consecutiveFails >= downThreshold ? DeviceStatusState.Down : DeviceStatusState.Warning,
            consecutiveFails);
    }
}
