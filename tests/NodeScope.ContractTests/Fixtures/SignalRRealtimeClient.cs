using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;

namespace NodeScope.ContractTests.Fixtures;

/// <summary>
/// SignalR implementation of <see cref="IRealtimeClient"/>, the C# host's side of the same
/// parity contract the socket.io client covers against Node (Decision 4). Inbound events are
/// captured through one catch-all handler per known event name into a shared buffer, so an
/// event arriving between connect and the wait meant for it is never lost, and each event is
/// handed to at most one waiter.
/// </summary>
public sealed class SignalRRealtimeClient : IRealtimeClient
{
    private static readonly TimeSpan DefaultEventTimeout = TimeSpan.FromSeconds(5);

    private readonly Uri _hubUri;
    private readonly object _gate = new();
    private readonly List<Received> _buffer = [];
    private readonly List<Waiter> _waiters = [];
    private readonly TaskCompletionSource _disconnected = new(TaskCreationOptions.RunContinuationsAsynchronously);

    private HubConnection? _hub;

    public SignalRRealtimeClient(Uri baseUri)
    {
        ArgumentNullException.ThrowIfNull(baseUri);
        _hubUri = new Uri(baseUri, RealtimeTransport.HubPath);
    }

    public bool Connected => _hub?.State == HubConnectionState.Connected;

    public async Task ConnectAsync(Auth? auth, CancellationToken cancellationToken = default)
    {
        if (_hub is not null)
        {
            throw new InvalidOperationException("This realtime client has already been connected.");
        }

        var builder = new HubConnectionBuilder().WithUrl(
            _hubUri,
            options =>
            {
                // WebSockets only: the parity tests are about the realtime path, and a silent
                // fall back to long polling would test something else.
                options.Transports = HttpTransportType.WebSockets;
                if (auth?.Cookie is { } cookie)
                {
                    options.Headers["Cookie"] = cookie;
                }

                if (auth?.BearerToken is { } bearer)
                {
                    options.Headers["Authorization"] = $"Bearer {bearer}";
                }

                foreach (var (name, value) in auth?.Headers ?? new Dictionary<string, string>())
                {
                    options.Headers[name] = value;
                }
            });

        _hub = builder.Build();
        foreach (var eventName in RealtimeTransport.ServerEvents)
        {
            var captured = eventName;
            _hub.On<JsonElement>(captured, payload => Capture(captured, payload));
        }

        _hub.Closed += _ =>
        {
            _disconnected.TrySetResult();
            return Task.CompletedTask;
        };

        try
        {
            await _hub.StartAsync(cancellationToken);
        }
        catch (HttpRequestException)
        {
            // An unauthenticated connection is refused during the handshake rather than
            // connected-then-closed as socket.io does. Both are "the server rejected me",
            // which is the contract these tests assert.
            _disconnected.TrySetResult();
        }
    }

    public Task<JsonElement> WaitForEventAsync(
        string eventName,
        Predicate<JsonElement>? match = null,
        TimeSpan? timeout = null)
    {
        var waiter = new Waiter(eventName, match);
        lock (_gate)
        {
            var index = _buffer.FindIndex(received => waiter.Matches(received));
            if (index >= 0)
            {
                var payload = _buffer[index].Payload;
                _buffer.RemoveAt(index);
                return Task.FromResult(payload);
            }

            _waiters.Add(waiter);
        }

        return AwaitWithTimeoutAsync(waiter, eventName, timeout ?? DefaultEventTimeout);
    }

    public Task WaitForDisconnectAsync(TimeSpan? timeout = null) =>
        _disconnected.Task.WaitAsync(timeout ?? DefaultEventTimeout);

    /// <summary>
    /// Invokes a hub method. SignalR has named methods where socket.io has client-to-server
    /// events, so the event name maps to the method of the same purpose.
    /// </summary>
    public async Task EmitAsync(string eventName, object? data = null)
    {
        if (_hub is null)
        {
            throw new InvalidOperationException("This realtime client is not connected.");
        }

        var method = RealtimeTransport.ClientMethod(eventName);
        await _hub.InvokeAsync(method);
    }

    public async ValueTask DisposeAsync()
    {
        if (_hub is not null)
        {
            await _hub.DisposeAsync();
        }
    }

    private void Capture(string eventName, JsonElement payload)
    {
        lock (_gate)
        {
            var received = new Received(eventName, payload);
            var index = _waiters.FindIndex(waiter => waiter.Matches(received));
            if (index < 0)
            {
                _buffer.Add(received);
                return;
            }

            var waiter = _waiters[index];
            _waiters.RemoveAt(index);
            waiter.Completion.TrySetResult(payload);
        }
    }

    private async Task<JsonElement> AwaitWithTimeoutAsync(Waiter waiter, string eventName, TimeSpan timeout)
    {
        try
        {
            return await waiter.Completion.Task.WaitAsync(timeout);
        }
        catch (TimeoutException)
        {
            lock (_gate)
            {
                _waiters.Remove(waiter);
            }

            throw new TimeoutException($"Timed out after {timeout.TotalSeconds:0}s waiting for realtime event '{eventName}'.");
        }
    }

    private sealed record Received(string EventName, JsonElement Payload);

    private sealed class Waiter
    {
        private readonly string _eventName;
        private readonly Predicate<JsonElement>? _match;

        public Waiter(string eventName, Predicate<JsonElement>? match)
        {
            _eventName = eventName;
            _match = match;
        }

        public TaskCompletionSource<JsonElement> Completion { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public bool Matches(Received received) =>
            received.EventName == _eventName && (_match is null || _match(received.Payload));
    }
}
