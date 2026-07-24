using System.Collections.Concurrent;
using System.Globalization;
using Microsoft.Extensions.Configuration;

namespace NodeScope.Modules.Realtime.Infrastructure;

/// <summary>
/// Per-user fixed-window limit for the hub's <c>metrics:submit</c> (Node's
/// <c>WS_METRICS_MAX_PER_WINDOW</c>): the HTTP throttler never sees hub invocations, so
/// without this an authenticated socket could emit submissions as fast as it can write,
/// driving unbounded INSERTs into the metrics hypertable - a client-driven disk-growth
/// runaway. The window is the wall-clock minute (Node keyed on the ISO minute tag), the
/// default 60 gives ~30x headroom over the browser collector's 2-per-minute-per-tab, and
/// over-limit submissions are dropped silently, exactly as Node dropped them.
/// </summary>
public sealed class MetricsSubmitLimiter
{
    private readonly ConcurrentDictionary<string, Window> _windows = new(StringComparer.Ordinal);
    private readonly int _maxPerWindow;
    private readonly TimeProvider _time;

    public MetricsSubmitLimiter(int maxPerWindow, TimeProvider? time = null)
    {
        _maxPerWindow = maxPerWindow;
        _time = time ?? TimeProvider.System;
    }

    /// <summary><c>WS_METRICS_RATE_LIMIT</c>, default 60, minimum 1 (Node's envInt bounds).</summary>
    public static MetricsSubmitLimiter FromConfiguration(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        var raw = configuration["WS_METRICS_RATE_LIMIT"];
        var max = int.TryParse(raw, NumberStyles.None, CultureInfo.InvariantCulture, out var value) && value >= 1
            ? value
            : 60;
        return new MetricsSubmitLimiter(max);
    }

    /// <summary>Counts one submission; false means drop it (over this minute's budget).</summary>
    public bool Allow(string userId)
    {
        // The minute tag rides in the value, so the window self-rolls at the boundary (a
        // fresh tag resets the count) and the map stays bounded by the active user set.
        var tag = _time.GetUtcNow().UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture);
        var window = _windows.AddOrUpdate(
            userId,
            static (_, minute) => new Window(minute, 1),
            static (_, previous, minute) =>
                previous.Tag == minute ? previous with { Count = previous.Count + 1 } : new Window(minute, 1),
            tag);
        return window.Count <= _maxPerWindow;
    }

    private sealed record Window(string Tag, int Count);
}
