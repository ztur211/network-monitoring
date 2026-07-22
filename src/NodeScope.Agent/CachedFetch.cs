namespace NodeScope.Agent;

/// <summary>
/// Wrap an async fetch so it returns a cached result and only re-fetches once the interval
/// has elapsed since the last successful fetch.
///
/// Used to stop the agent re-syncing the full device list on every short probe cycle: the
/// list changes rarely, and each sync triggers server-side SNMP-credential decryption, so
/// it's fetched on the slower sync cadence instead of the probe cadence. A failed fetch does
/// NOT update the cache, so the next call retries immediately. Concurrent callers that
/// arrive while a fetch is in flight share that one task rather than each launching their
/// own - two overlapping callers must not fire two real syncs (two credential decrypts).
/// </summary>
internal sealed class CachedFetch<T>(Func<Task<T>> fetch, long intervalMs, Func<long>? nowMs = null)
{
    private readonly Func<long> _nowMs = nowMs ?? (static () => Environment.TickCount64);
    private readonly object _gate = new();
    private T? _cache;
    private bool _primed;
    private long _lastAt;
    private Task<T>? _inflight;

    public Task<T> GetAsync()
    {
        lock (_gate)
        {
            var now = _nowMs();
            if (_primed && now - _lastAt < intervalMs)
            {
                return Task.FromResult(_cache!);
            }

            if (_inflight is not null)
            {
                return _inflight;
            }

            var task = FetchAsync(now);
            // A synchronously-completed fetch has ALREADY run its finally by the time we get
            // the task back, so storing it here would leave a stale completed task in
            // _inflight forever - after the next expiry every caller would be handed the old
            // result (or a cached exception) instead of a re-fetch. Unlike JS, a C# await
            // does not guarantee a yield, so only a still-pending task may be published.
            if (!task.IsCompleted)
            {
                _inflight = task;
            }

            return task;
        }
    }

    private async Task<T> FetchAsync(long startedAt)
    {
        try
        {
            var result = await fetch();
            lock (_gate)
            {
                _cache = result;
                _primed = true;
                _lastAt = startedAt;
            }

            return result;
        }
        finally
        {
            // Clear on success AND failure - a failed fetch stays un-cached and retries.
            lock (_gate)
            {
                _inflight = null;
            }
        }
    }
}
