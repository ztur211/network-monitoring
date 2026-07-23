namespace NodeScope.Modules.Monitoring.Domain;

/// <summary>The <c>DeviceStatusState</c> Postgres enum. Labels are the CONSTANT_CASE member names.</summary>
public enum DeviceStatusState
{
    Up,
    Down,
    Warning,
    Unknown,
}

/// <summary>Wire/label conversion for <see cref="DeviceStatusState"/>.</summary>
public static class DeviceStatusStateLabel
{
    public static string Of(DeviceStatusState state) => state switch
    {
        DeviceStatusState.Up => "UP",
        DeviceStatusState.Down => "DOWN",
        DeviceStatusState.Warning => "WARNING",
        DeviceStatusState.Unknown => "UNKNOWN",
        _ => throw new ArgumentOutOfRangeException(nameof(state)),
    };
}
