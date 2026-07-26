namespace NodeScope.Desktop.Realtime;

/// <summary>
/// The appliance's realtime wire as far as the client needs it so far: the assistant's
/// chat channel. The realtime milestone grows this with entity updates and metrics.
/// Event handlers are invoked on the UI thread; subscriptions end with their disposable.
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

    public IDisposable OnAiToken(Action<AiTokenEvent> handler);

    public IDisposable OnAiComplete(Action<AiCompleteEvent> handler);

    public IDisposable OnError(Action<RealtimeErrorEvent> handler);
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
