namespace NodeScope.ContractTests.Fixtures;

/// <summary>
/// The realtime client contract used by the black-box SignalR tests. It captures
/// semantic behavior: which event fires, with which payload, to which subscriber.
/// </summary>
public interface IRealtimeClient : IAsyncDisposable
{
    /// <summary>True while the underlying connection is active.</summary>
    public bool Connected { get; }

    /// <summary>
    /// Connects to the hub with the supplied credential, or anonymously when null
    /// so the suite can verify authentication rejection.
    /// </summary>
    public Task ConnectAsync(Auth? auth, CancellationToken cancellationToken = default);

    /// <summary>
    /// Resolves with the next matching event payload, whether already buffered or
    /// received before the timeout. Each event is delivered to at most one waiter.
    /// </summary>
    public Task<JsonElement> WaitForEventAsync(
        string eventName,
        Predicate<JsonElement>? match = null,
        TimeSpan? timeout = null);

    /// <summary>Resolves when the connection closes, or throws on timeout.</summary>
    public Task WaitForDisconnectAsync(TimeSpan? timeout = null);

    /// <summary>Sends one client-to-server realtime event.</summary>
    public Task EmitAsync(string eventName, object? data = null);
}
