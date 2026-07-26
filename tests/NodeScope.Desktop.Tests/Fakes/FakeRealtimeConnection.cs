using NodeScope.Desktop.Realtime;

namespace NodeScope.Desktop.Tests.Fakes;

/// <summary>
/// An in-memory realtime wire: records sends, and hands the test the server's side of
/// the conversation - raising an event invokes the live handlers synchronously, the way
/// the production connection posts them one at a time onto the UI thread.
/// </summary>
internal sealed class FakeRealtimeConnection : IRealtimeConnection
{
    private readonly List<Action<AiTokenEvent>> _tokenHandlers = [];
    private readonly List<Action<AiCompleteEvent>> _completeHandlers = [];
    private readonly List<Action<RealtimeErrorEvent>> _errorHandlers = [];
    private readonly List<Action<DeviceUpdatedEvent>> _deviceUpdatedHandlers = [];
    private readonly List<Action<DeviceDeletedEvent>> _deviceDeletedHandlers = [];
    private readonly List<Action<CircuitUpdatedEvent>> _circuitUpdatedHandlers = [];
    private readonly List<Action<CircuitDeletedEvent>> _circuitDeletedHandlers = [];
    private readonly List<Action<MetricsUpdateEvent>> _metricsHandlers = [];
    private readonly List<Action> _reconnectedHandlers = [];

    public List<(string Content, string? ConversationId)> SentMessages { get; } = [];

    public List<MetricsSubmission> SubmittedMetrics { get; } = [];

    public Exception? SendFailure { get; set; }

    /// <summary>What <see cref="PingAsync"/> reports; null makes the ping fail.</summary>
    public TimeSpan? PingRoundTrip { get; set; } = TimeSpan.FromMilliseconds(20);

    public int StartCalls { get; private set; }

    public bool Disposed { get; private set; }

    public void Start() => StartCalls++;

    public Task SendAiMessageAsync(string content, string? conversationId, CancellationToken cancellationToken)
    {
        if (SendFailure is not null)
        {
            return Task.FromException(Unavailable(SendFailure));
        }

        SentMessages.Add((content, conversationId));
        return Task.CompletedTask;
    }

    public Task SubmitMetricsAsync(MetricsSubmission metrics, CancellationToken cancellationToken)
    {
        if (SendFailure is not null)
        {
            return Task.FromException(Unavailable(SendFailure));
        }

        SubmittedMetrics.Add(metrics);
        return Task.CompletedTask;
    }

    public Task<TimeSpan> PingAsync(CancellationToken cancellationToken) =>
        PingRoundTrip is { } roundTrip
            ? Task.FromResult(roundTrip)
            : Task.FromException<TimeSpan>(new RealtimeUnavailableException("The fake wire is down."));

    public IDisposable OnAiToken(Action<AiTokenEvent> handler) => Track(_tokenHandlers, handler);

    public IDisposable OnAiComplete(Action<AiCompleteEvent> handler) => Track(_completeHandlers, handler);

    public IDisposable OnError(Action<RealtimeErrorEvent> handler) => Track(_errorHandlers, handler);

    public IDisposable OnDeviceUpdated(Action<DeviceUpdatedEvent> handler) => Track(_deviceUpdatedHandlers, handler);

    public IDisposable OnDeviceDeleted(Action<DeviceDeletedEvent> handler) => Track(_deviceDeletedHandlers, handler);

    public IDisposable OnCircuitUpdated(Action<CircuitUpdatedEvent> handler) => Track(_circuitUpdatedHandlers, handler);

    public IDisposable OnCircuitDeleted(Action<CircuitDeletedEvent> handler) => Track(_circuitDeletedHandlers, handler);

    public IDisposable OnMetricsUpdate(Action<MetricsUpdateEvent> handler) => Track(_metricsHandlers, handler);

    public IDisposable OnReconnected(Action handler)
    {
        _reconnectedHandlers.Add(handler);
        return new Subscription(() => _reconnectedHandlers.Remove(handler));
    }

    public void RaiseToken(AiTokenEvent received) => Raise(_tokenHandlers, received);

    public void RaiseComplete(AiCompleteEvent received) => Raise(_completeHandlers, received);

    public void RaiseError(RealtimeErrorEvent received) => Raise(_errorHandlers, received);

    public void RaiseDeviceUpdated(DeviceUpdatedEvent received) => Raise(_deviceUpdatedHandlers, received);

    public void RaiseDeviceDeleted(DeviceDeletedEvent received) => Raise(_deviceDeletedHandlers, received);

    public void RaiseCircuitUpdated(CircuitUpdatedEvent received) => Raise(_circuitUpdatedHandlers, received);

    public void RaiseCircuitDeleted(CircuitDeletedEvent received) => Raise(_circuitDeletedHandlers, received);

    public void RaiseMetricsUpdate(MetricsUpdateEvent received) => Raise(_metricsHandlers, received);

    public void RaiseReconnected()
    {
        foreach (var handler in _reconnectedHandlers.ToList())
        {
            handler();
        }
    }

    public void Dispose() => Disposed = true;

    private static RealtimeUnavailableException Unavailable(Exception failure) =>
        failure as RealtimeUnavailableException
            ?? new RealtimeUnavailableException("The realtime channel could not deliver the message.", failure);

    private static void Raise<T>(List<Action<T>> handlers, T received)
    {
        foreach (var handler in handlers.ToList())
        {
            handler(received);
        }
    }

    private static Subscription Track<T>(List<Action<T>> handlers, Action<T> handler)
    {
        handlers.Add(handler);
        return new Subscription(() => handlers.Remove(handler));
    }

    private sealed class Subscription(Action remove) : IDisposable
    {
        public void Dispose() => remove();
    }
}

internal sealed class FakeRealtimeConnectionFactory : IRealtimeConnectionFactory
{
    public List<FakeRealtimeConnection> Created { get; } = [];

    public IRealtimeConnection Create(Uri serverUrl, string bearerToken)
    {
        var connection = new FakeRealtimeConnection();
        Created.Add(connection);
        return connection;
    }
}
