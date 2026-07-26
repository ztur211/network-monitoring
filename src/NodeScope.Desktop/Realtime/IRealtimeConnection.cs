namespace NodeScope.Desktop.Realtime;

/// <summary>
/// The appliance's realtime wire as far as the client needs it: the assistant's chat
/// channel, entity update/delete deltas, and the metrics loop. Event handlers are
/// invoked on the UI thread; subscriptions end with their disposable.
/// </summary>
internal interface IRealtimeConnection : IDisposable
{
    /// <summary>
    /// Begins connecting in the background and keeps at it: the initial attempt retries
    /// with backoff until it lands, and an established connection reconnects on its own.
    /// Safe to call once; the connection never surfaces its state as an exception here.
    /// </summary>
    public void Start();

    /// <summary>
    /// Asks the assistant. The answer streams back to the user's whole client group as
    /// <c>v1:ai:token</c> then <c>v1:ai:complete</c> events, not as a return value.
    /// </summary>
    /// <exception cref="RealtimeUnavailableException">The message could not be delivered.</exception>
    public Task SendAiMessageAsync(string content, string? conversationId, CancellationToken cancellationToken);

    /// <summary>
    /// Submits one collector sample (<c>MetricsSubmit</c>). Fire-and-store: the server
    /// answers nothing, and the sample comes back on the next scheduled
    /// <c>v1:metrics:update</c> push. Over-limit submissions are silently dropped.
    /// </summary>
    /// <exception cref="RealtimeUnavailableException">The sample could not be delivered.</exception>
    public Task SubmitMetricsAsync(MetricsSubmission metrics, CancellationToken cancellationToken);

    /// <summary>
    /// One <c>Ping</c> round-trip, timed. The web collector measured emit-to-pong; the
    /// hub invocation's completion is the same round trip with an ack instead of an event.
    /// </summary>
    /// <exception cref="RealtimeUnavailableException">The ping could not be delivered.</exception>
    public Task<TimeSpan> PingAsync(CancellationToken cancellationToken);

    public IDisposable OnAiToken(Action<AiTokenEvent> handler);

    public IDisposable OnAiComplete(Action<AiCompleteEvent> handler);

    public IDisposable OnError(Action<RealtimeErrorEvent> handler);

    public IDisposable OnDeviceUpdated(Action<DeviceUpdatedEvent> handler);

    public IDisposable OnDeviceDeleted(Action<DeviceDeletedEvent> handler);

    public IDisposable OnCircuitUpdated(Action<CircuitUpdatedEvent> handler);

    public IDisposable OnCircuitDeleted(Action<CircuitDeletedEvent> handler);

    public IDisposable OnMetricsUpdate(Action<MetricsUpdateEvent> handler);

    /// <summary>
    /// Fires after automatic reconnect restores a dropped connection - never for the
    /// initial connect. The server replays nothing across the gap, so consumers refetch
    /// what they own; the web client accepted the lost deltas instead (recorded deviation).
    /// </summary>
    public IDisposable OnReconnected(Action handler);
}

/// <summary>
/// Creates a connection for a signed-in session. A factory because the URL and token are
/// session state, not deployment configuration - each sign-in gets a fresh connection.
/// </summary>
internal interface IRealtimeConnectionFactory
{
    public IRealtimeConnection Create(Uri serverUrl, string bearerToken);
}

/// <summary>A send that never reached the appliance, whatever the transport's reason.</summary>
internal sealed class RealtimeUnavailableException : Exception
{
    public RealtimeUnavailableException()
    {
    }

    public RealtimeUnavailableException(string message)
        : base(message)
    {
    }

    public RealtimeUnavailableException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
