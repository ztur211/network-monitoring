using SocketIOClient;
using SocketIOClient.Common;

namespace NodeScope.ContractTests.Fixtures;

/// <summary>
/// The transport-agnostic realtime client the websocket parity tests assert behind
/// (Decision 4). The wire protocol changes socket.io -> SignalR at the port, but the
/// parity that matters is semantic - which event fires, with which payload, to which
/// subscribers - so the tests speak to this interface and a swap of the implementation
/// carries them to the C# host unchanged. <see cref="SocketIoRealtimeClient"/> is the
/// socket.io implementation used against the Node target; a SignalR one drops in later.
/// </summary>
public interface IRealtimeClient : IAsyncDisposable
{
    /// <summary>True while the underlying socket is connected.</summary>
    public bool Connected { get; }

    /// <summary>
    /// Connects and authenticates the socket with <paramref name="auth"/> (the same
    /// bearer credential the HTTP suite mints), or with no credential when null - the
    /// case the server must reject.
    /// </summary>
    public Task ConnectAsync(Auth? auth, CancellationToken cancellationToken = default);

    /// <summary>
    /// Resolves with the payload of the next <paramref name="eventName"/> that satisfies
    /// <paramref name="match"/> (any, when null), whether it was already buffered or
    /// arrives within <paramref name="timeout"/>. Each received event is delivered to
    /// at most one waiter. Throws <see cref="TimeoutException"/> if none arrives - which
    /// is exactly how a test asserts an event must NOT reach this subscriber.
    /// </summary>
    public Task<JsonElement> WaitForEventAsync(string eventName, Predicate<JsonElement>? match = null, TimeSpan? timeout = null);

    /// <summary>Resolves once the socket has been disconnected, or throws on timeout.</summary>
    public Task WaitForDisconnectAsync(TimeSpan? timeout = null);

    /// <summary>Emits a client-to-server event (e.g. the ping).</summary>
    public Task EmitAsync(string eventName, object? data = null);
}

/// <summary>
/// socket.io implementation of <see cref="IRealtimeClient"/> over SocketIOClient. Every
/// inbound event is captured through a single <c>OnAny</c> hook into a buffer, so an event
/// that fires between connect and the wait it is meant for is never lost, and each event is
/// handed to at most one waiter (consume-once). Scoped to the socket.io era; removed at the
/// SignalR port.
/// </summary>
public sealed class SocketIoRealtimeClient : IRealtimeClient
{
    private static readonly TimeSpan DefaultEventTimeout = TimeSpan.FromSeconds(5);

    private readonly Uri _baseUri;
    private readonly object _gate = new();
    private readonly List<Received> _buffer = [];
    private readonly List<Waiter> _waiters = [];
    private readonly TaskCompletionSource _disconnected = new(TaskCreationOptions.RunContinuationsAsynchronously);

    private SocketIO? _io;

    public SocketIoRealtimeClient(Uri baseUri) => _baseUri = baseUri;

    public bool Connected => _io?.Connected ?? false;

    public async Task ConnectAsync(Auth? auth, CancellationToken cancellationToken = default)
    {
        if (_io is not null)
        {
            throw new InvalidOperationException("This realtime client has already been connected.");
        }

        var options = new SocketIOOptions
        {
            EIO = EngineIO.V4,
            Path = "/socket.io",
            // A parity test wants one deterministic connection; reconnection would mask a
            // server-forced disconnect (the auth-rejection contract) as a transient blip.
            Reconnection = false,
            ConnectionTimeout = TimeSpan.FromSeconds(10),
        };
        var headers = BuildHeaders(auth);
        if (headers.Count > 0)
        {
            options.ExtraHeaders = headers;
        }

        var io = new SocketIO(_baseUri, options);
        io.OnDisconnected += (_, _) => _disconnected.TrySetResult();
        io.OnAny((name, ctx) =>
        {
            JsonElement payload;
            try
            {
                payload = ctx.GetValue<JsonElement>(0);
            }
            catch (ArgumentOutOfRangeException)
            {
                // An event carrying no argument still counts as "the event fired".
                payload = default;
            }
            catch (IndexOutOfRangeException)
            {
                payload = default;
            }
            catch (JsonException)
            {
                payload = default;
            }

            Deliver(name, payload);
            return Task.CompletedTask;
        });

        _io = io;
        await io.ConnectAsync(cancellationToken);
    }

    public Task<JsonElement> WaitForEventAsync(string eventName, Predicate<JsonElement>? match = null, TimeSpan? timeout = null)
    {
        TaskCompletionSource<JsonElement> completion;
        lock (_gate)
        {
            foreach (var received in _buffer)
            {
                if (!received.Consumed && received.Event == eventName && (match is null || match(received.Payload)))
                {
                    received.Consumed = true;
                    return Task.FromResult(received.Payload);
                }
            }

            completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
            _waiters.Add(new Waiter(eventName, match, completion));
        }

        return AwaitWithTimeoutAsync(completion, eventName, timeout ?? DefaultEventTimeout);
    }

    public async Task WaitForDisconnectAsync(TimeSpan? timeout = null)
    {
        if (!Connected)
        {
            return;
        }

        var delay = Task.Delay(timeout ?? DefaultEventTimeout);
        var done = await Task.WhenAny(_disconnected.Task, delay);
        if (done == delay && Connected)
        {
            throw new TimeoutException("Timed out waiting for the realtime socket to disconnect.");
        }
    }

    public Task EmitAsync(string eventName, object? data = null)
    {
        var io = _io ?? throw new InvalidOperationException("Connect the realtime client before emitting.");
        return data is null ? io.EmitAsync(eventName) : io.EmitAsync(eventName, [data]);
    }

    public ValueTask DisposeAsync()
    {
        // Abrupt teardown is fine for a test client: the server treats the transport close as a
        // normal disconnect. Dispose() closes the socket, so no graceful DisconnectAsync is needed.
        _io?.Dispose();
        return ValueTask.CompletedTask;
    }

    private static Dictionary<string, string> BuildHeaders(Auth? auth)
    {
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (auth is null)
        {
            return headers;
        }

        if (auth.BearerToken is not null)
        {
            headers["Authorization"] = "Bearer " + auth.BearerToken;
        }

        if (auth.Headers is not null)
        {
            foreach (var (name, value) in auth.Headers)
            {
                headers[name] = value;
            }
        }

        return headers;
    }

    private async Task<JsonElement> AwaitWithTimeoutAsync(
        TaskCompletionSource<JsonElement> completion,
        string eventName,
        TimeSpan timeout)
    {
        using var cts = new CancellationTokenSource(timeout);
        await using (cts.Token.Register(() => completion.TrySetCanceled()).ConfigureAwait(false))
        {
            try
            {
                return await completion.Task;
            }
            catch (TaskCanceledException)
            {
                lock (_gate)
                {
                    _waiters.RemoveAll(w => w.Completion == completion);
                }

                throw new TimeoutException(
                    $"Timed out after {timeout.TotalSeconds:0.#}s waiting for realtime event '{eventName}'.");
            }
        }
    }

    private void Deliver(string name, JsonElement payload)
    {
        lock (_gate)
        {
            for (var i = 0; i < _waiters.Count; i++)
            {
                var waiter = _waiters[i];
                if (waiter.Event == name && (waiter.Match is null || waiter.Match(payload)))
                {
                    _waiters.RemoveAt(i);
                    waiter.Completion.TrySetResult(payload);
                    return;
                }
            }

            _buffer.Add(new Received(name, payload));
        }
    }

    private sealed class Received(string @event, JsonElement payload)
    {
        public string Event { get; } = @event;

        public JsonElement Payload { get; } = payload;

        public bool Consumed { get; set; }
    }

    private sealed record Waiter(string Event, Predicate<JsonElement>? Match, TaskCompletionSource<JsonElement> Completion);
}
