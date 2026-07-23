using System.Globalization;
using System.Text.RegularExpressions;

namespace NodeScope.Modules.Monitoring.Domain;

/// <summary>
/// Chart-bucket rules ported from <c>monitoring.dto.ts</c> + <c>monitoring.repository.ts</c>:
/// the allow-listed widths (bounding WORK, not escaping - values are always SQL parameters),
/// the interval parser, and continuous-aggregate eligibility. The 5-minute grid alignment
/// rule keeps cagg and raw answers identical wherever the cagg is used, so the fallback can
/// never change a chart.
/// </summary>
public static partial class MetricBuckets
{
    public const string DefaultBucket = "5 minutes";
    public const int DefaultWindowMs = 3_600_000;
    public const int MaxMetricBuckets = 5_000;
    private const int CaggBucketSeconds = 300;

    public static readonly IReadOnlyList<string> Allowed =
        ["30 seconds", "1 minute", "5 minutes", "15 minutes", "1 hour", "6 hours", "1 day"];

    /// <summary>Best-effort parse of a Postgres interval ('5 minutes', '1 hour', ...) to seconds.</summary>
    public static long BucketSeconds(string bucket)
    {
        ArgumentNullException.ThrowIfNull(bucket);
        var match = IntervalPattern().Match(bucket);
        if (!match.Success)
        {
            return 0;
        }

        var factor = match.Groups[2].Value.ToUpperInvariant() switch
        {
            "SECOND" => 1L,
            "MINUTE" => 60L,
            "HOUR" => 3600L,
            "DAY" => 86400L,
            "WEEK" => 604800L,
            _ => 0L,
        };
        return long.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture) * factor;
    }

    /// <summary>
    /// True when the query may be served from the 5-min aggregate: bucket is a whole multiple
    /// of 5 min AND both window edges sit on the epoch-aligned 5-min grid.
    /// </summary>
    public static bool IsCaggEligible(DateTime fromUtc, DateTime toUtc, string bucket)
    {
        var seconds = BucketSeconds(bucket);
        const long gridMs = CaggBucketSeconds * 1000L;
        return seconds >= CaggBucketSeconds
            && seconds % CaggBucketSeconds == 0
            && EpochMs(fromUtc) % gridMs == 0
            && EpochMs(toUtc) % gridMs == 0;
    }

    private static long EpochMs(DateTime utc) =>
        new DateTimeOffset(DateTime.SpecifyKind(utc, DateTimeKind.Utc)).ToUnixTimeMilliseconds();

    [GeneratedRegex(@"^\s*(\d+)\s*(second|minute|hour|day|week)s?\s*$", RegexOptions.IgnoreCase)]
    private static partial Regex IntervalPattern();
}
