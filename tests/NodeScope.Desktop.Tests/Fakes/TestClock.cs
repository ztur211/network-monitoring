namespace NodeScope.Desktop.Tests.Fakes;

/// <summary>Settable clock pinned to UTC so time-dependent behavior is deterministic.</summary>
public sealed class TestClock(DateTimeOffset start) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = start;

    public override DateTimeOffset GetUtcNow() => Now.ToUniversalTime();

    public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.Utc;
}
