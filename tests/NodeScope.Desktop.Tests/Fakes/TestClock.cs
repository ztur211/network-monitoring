namespace NodeScope.Desktop.Tests.Fakes;

/// <summary>Settable clock pinned to UTC so time-dependent behavior is deterministic.</summary>
public sealed class TestClock(DateTimeOffset start) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = start;

    public override DateTimeOffset GetUtcNow() => Now.ToUniversalTime();

    public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.Utc;

    /// <summary>Timestamps ride the settable clock too, so elapsed-time measurement
    /// (the bandwidth probes) is as deterministic as wall-clock reads.</summary>
    public override long GetTimestamp() => Now.UtcTicks;

    public override long TimestampFrequency => TimeSpan.TicksPerSecond;

    public void Advance(TimeSpan delta) => Now += delta;
}
