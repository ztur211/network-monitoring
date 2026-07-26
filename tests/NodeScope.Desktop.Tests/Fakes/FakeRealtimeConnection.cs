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

    public List<(string Content, string? ConversationId)> SentMessages { get; } = [];

    public Exception? SendFailure { get; set; }

    public int StartCalls { get; private set; }

    public bool Disposed { get; private set; }

    public void Start() => StartCalls++;

    public Task SendAiMessageAsync(string content, string? conversationId, CancellationToken cancellationToken)
    {
        if (SendFailure is not null)
        {
            return Task.FromException(SendFailure is RealtimeUnavailableException
                ? SendFailure
                : new RealtimeUnavailableException("The realtime channel could not deliver the message.", SendFailure));
        }

        SentMessages.Add((content, conversationId));
        return Task.CompletedTask;
    }

    public IDisposable OnAiToken(Action<AiTokenEvent> handler) => Track(_tokenHandlers, handler);

    public IDisposable OnAiComplete(Action<AiCompleteEvent> handler) => Track(_completeHandlers, handler);

    public IDisposable OnError(Action<RealtimeErrorEvent> handler) => Track(_errorHandlers, handler);

    public void RaiseToken(AiTokenEvent received)
    {
        foreach (var handler in _tokenHandlers.ToList())
        {
            handler(received);
        }
    }

    public void RaiseComplete(AiCompleteEvent received)
    {
        foreach (var handler in _completeHandlers.ToList())
        {
            handler(received);
        }
    }

    public void RaiseError(RealtimeErrorEvent received)
    {
        foreach (var handler in _errorHandlers.ToList())
        {
            handler(received);
        }
    }

    public void Dispose() => Disposed = true;

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
