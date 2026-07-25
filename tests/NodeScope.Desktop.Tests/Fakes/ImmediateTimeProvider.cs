namespace NodeScope.Desktop.Tests.Fakes;

/// <summary>
/// A TimeProvider whose timers fire synchronously on creation, collapsing the map's
/// debounce windows so tests observe the settled state without real waits.
/// </summary>
public sealed class ImmediateTimeProvider : TimeProvider
{
    public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
    {
        callback(state);
        return new FiredTimer();
    }

    private sealed class FiredTimer : ITimer
    {
        public bool Change(TimeSpan dueTime, TimeSpan period) => false;

        public void Dispose()
        {
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
