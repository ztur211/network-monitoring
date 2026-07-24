using System.Collections.Concurrent;

namespace NodeScope.Platform.Http;

/// <summary>One <see cref="ThrottleStore.Hit"/> verdict, shaped like the Node storage record.</summary>
public readonly record struct ThrottleResult(
    int TotalHits,
    int TimeToExpireSeconds,
    bool IsBlocked,
    int TimeToBlockExpireSeconds);

/// <summary>
/// In-process rate-limit storage reproducing the installed @nestjs/throttler 6.5
/// <c>ThrottlerStorageService</c> (the storage Node runs when Redis is disabled, which is the
/// Decision 8 single-node state): hits decay INDIVIDUALLY one ttl after they landed (the
/// per-hit setTimeout decrement), a separate rolling window marker feeds the Reset header,
/// and crossing the limit blocks the key for <c>blockDuration</c> - during which requests
/// are rejected without accruing hits or extending the block; when the block lapses the
/// counter resets and the current request counts as the fresh window's first hit.
/// <para>One library bug is deliberately NOT reproduced: upstream's block-reset clears the
/// pending hit decrements of EVERY key sharing the bucket name, freezing other clients'
/// counters at their current value until process restart. Here decay is per-key.</para>
/// </summary>
public sealed class ThrottleStore
{
    private readonly ConcurrentDictionary<string, Entry> _entries = new(StringComparer.Ordinal);
    private readonly TimeProvider _time;
    private int _sweepCountdown = SweepEvery;

    private const int SweepEvery = 4096;

    public ThrottleStore(TimeProvider time)
    {
        _time = time;
    }

    public ThrottleResult Hit(string key, int limit, TimeSpan ttl, TimeSpan blockDuration)
    {
        SweepOccasionally();
        var entry = _entries.GetOrAdd(key, static _ => new Entry());
        var now = _time.GetUtcNow();
        lock (entry.Gate)
        {
            entry.HitExpiries.RemoveAll(expiry => expiry <= now);

            if (entry.WindowExpiresAt <= now)
            {
                entry.WindowExpiresAt = now + ttl;
            }

            var timeToExpire = CeilSeconds(entry.WindowExpiresAt - now);

            if (!entry.IsBlocked)
            {
                entry.HitExpiries.Add(now + ttl);
            }

            if (entry.HitExpiries.Count > limit && !entry.IsBlocked)
            {
                entry.IsBlocked = true;
                entry.BlockExpiresAt = now + blockDuration;
            }

            var timeToBlockExpire = CeilSeconds(entry.BlockExpiresAt - now);
            if (timeToBlockExpire <= 0 && entry.IsBlocked)
            {
                entry.IsBlocked = false;
                entry.HitExpiries.Clear();
                entry.HitExpiries.Add(now + ttl);
                timeToBlockExpire = 0;
            }

            return new ThrottleResult(entry.HitExpiries.Count, timeToExpire, entry.IsBlocked, timeToBlockExpire);
        }
    }

    private static int CeilSeconds(TimeSpan span) => (int)Math.Ceiling(span.TotalSeconds);

    /// <summary>
    /// Drops dead entries (no live hits, no live block) every <see cref="SweepEvery"/> hits, so
    /// one-off clients do not accumulate forever. A concurrent hit racing a removal simply
    /// re-creates a fresh entry, which for a client idle past its ttl is the correct state.
    /// </summary>
    private void SweepOccasionally()
    {
        if (Interlocked.Decrement(ref _sweepCountdown) > 0)
        {
            return;
        }

        Interlocked.Exchange(ref _sweepCountdown, SweepEvery);
        var now = _time.GetUtcNow();
        foreach (var (key, entry) in _entries)
        {
            lock (entry.Gate)
            {
                entry.HitExpiries.RemoveAll(expiry => expiry <= now);
                if (entry.HitExpiries.Count == 0 && (!entry.IsBlocked || entry.BlockExpiresAt <= now))
                {
                    _entries.TryRemove(key, out _);
                }
            }
        }
    }

    private sealed class Entry
    {
        public object Gate { get; } = new();

        public List<DateTimeOffset> HitExpiries { get; } = [];

        public DateTimeOffset WindowExpiresAt { get; set; }

        public DateTimeOffset BlockExpiresAt { get; set; }

        public bool IsBlocked { get; set; }
    }
}
