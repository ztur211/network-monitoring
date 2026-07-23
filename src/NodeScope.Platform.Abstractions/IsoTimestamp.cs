using System.Globalization;

namespace NodeScope.Platform.Abstractions;

/// <summary>
/// Timestamps in JavaScript's <c>Date.prototype.toISOString()</c> shape: UTC, exactly
/// millisecond precision, <c>Z</c> suffix. Envelopes, DTO date fields, and realtime payload
/// timestamps all use it, because that is what every Node response carried.
/// </summary>
public static class IsoTimestamp
{
    private const string Format = "yyyy-MM-dd'T'HH':'mm':'ss'.'fff'Z'";

    public static string Now() => Of(DateTime.UtcNow);

    /// <summary>Formats <paramref name="value"/>; Unspecified kinds are treated as UTC (DB reads).</summary>
    public static string Of(DateTime value)
    {
        var utc = value.Kind == DateTimeKind.Local ? value.ToUniversalTime() : value;
        return utc.ToString(Format, CultureInfo.InvariantCulture);
    }
}
