using System.Text.Json;
using Avalonia.Threading;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Logging;
using NodeScope.Contracts.Realtime;

namespace NodeScope.Desktop.Realtime;

/// <summary>
/// The SignalR connection to the appliance's <c>/hubs/v1</c>. Bearer-only like the HTTP
/// client; WebSockets with the framework's negotiated fallbacks. Server events arrive on
/// transport threads, so every handler is re-posted through the constructor's post
/// action - the UI thread in production - and view models never see a cross-thread
/// callback.
/// </summary>
internal sealed class RealtimeConnection : IRealtimeConnection
{
    /// <summary>The hub method serving <c>v1:ai:message</c>.</summary>
    private const string AiMessageMethod = "AiMessage";

    /// <summary>The hub method serving <c>v1:metrics:submit</c>.</summary>
    private const string MetricsSubmitMethod = "MetricsSubmit";

    /// <summary>The hub method serving <c>v1:ping</c>.</summary>
    private const string PingMethod = "Ping";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly HubConnection _hub;
    private readonly ILogger _logger;
    private readonly Action<Action> _post;
    private readonly Uri _hubUrl;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly List<Action> _reconnectedHandlers = [];
    private readonly Lock _reconnectedGate = new();
    private int _started;

    public RealtimeConnection(Uri serverUrl, string bearerToken, ILogger logger, Action<Action> post)
    {
        ArgumentNullException.ThrowIfNull(serverUrl);
        _logger = logger;
        _post = post;
        _hubUrl = new Uri(serverUrl, "hubs/v1");
        _hub = new HubConnectionBuilder()
            .WithUrl(_hubUrl, options => options.Headers["Authorization"] = $"Bearer {bearerToken}")
            .WithAutomaticReconnect(new SteadyRetryPolicy())
            .Build();

        _hub.Reconnecting += failure =>
        {
            RealtimeLog.Reconnecting(_logger, _hubUrl, failure);
            return Task.CompletedTask;
        };
        _hub.Reconnected += _ =>
        {
            RealtimeLog.Connected(_logger, _hubUrl);
            Action[] handlers;
            lock (_reconnectedGate)
            {
                handlers = [.. _reconnectedHandlers];
            }

            foreach (var handler in handlers)
            {
                _post(handler);
            }

            return Task.CompletedTask;
        };
    }

    /// <summary>The initial connect loop; observed by tests and the live E2E.</summary>
    internal Task Connecting { get; private set; } = Task.CompletedTask;

    public void Start()
    {
        if (Interlocked.Exchange(ref _started, 1) == 1)
        {
            return;
        }

        Connecting = Task.Run(ConnectLoopAsync);
    }

    public async Task SendAiMessageAsync(
        string content, string? conversationId, CancellationToken cancellationToken)
    {
        try
        {
            await _hub.InvokeAsync(AiMessageMethod, new { content, conversationId }, cancellationToken);
        }
        catch (Exception failure) when (failure is not OperationCanceledException)
        {
            // Whatever the transport's reason - never started, mid-reconnect, socket torn
            // down - the caller's situation is the same: the message did not get through.
            throw new RealtimeUnavailableException(
                "The realtime channel could not deliver the message.", failure);
        }
    }

    public async Task SubmitMetricsAsync(MetricsSubmission metrics, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(metrics);
        try
        {
            await _hub.InvokeAsync(
                MetricsSubmitMethod,
                new
                {
                    bandwidthDown = metrics.BandwidthDown,
                    bandwidthUp = metrics.BandwidthUp,
                    latency = metrics.Latency,
                    connectionQuality = metrics.ConnectionQuality,
                },
                cancellationToken);
        }
        catch (Exception failure) when (failure is not OperationCanceledException)
        {
            throw new RealtimeUnavailableException(
                "The realtime channel could not deliver the metrics sample.", failure);
        }
    }

    public async Task<TimeSpan> PingAsync(CancellationToken cancellationToken)
    {
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        try
        {
            await _hub.InvokeAsync(PingMethod, cancellationToken);
        }
        catch (Exception failure) when (failure is not OperationCanceledException)
        {
            throw new RealtimeUnavailableException(
                "The realtime channel could not deliver the ping.", failure);
        }

        return System.Diagnostics.Stopwatch.GetElapsedTime(started);
    }

    public IDisposable OnAiToken(Action<AiTokenEvent> handler) =>
        Subscribe(WsEvents.AiToken, handler);

    public IDisposable OnAiComplete(Action<AiCompleteEvent> handler) =>
        Subscribe(WsEvents.AiComplete, handler);

    public IDisposable OnError(Action<RealtimeErrorEvent> handler) =>
        Subscribe(WsEvents.Error, handler);

    public IDisposable OnDeviceUpdated(Action<DeviceUpdatedEvent> handler) =>
        Subscribe(WsEvents.DeviceUpdated, handler);

    public IDisposable OnDeviceDeleted(Action<DeviceDeletedEvent> handler) =>
        Subscribe(WsEvents.DeviceDeleted, handler);

    public IDisposable OnCircuitUpdated(Action<CircuitUpdatedEvent> handler) =>
        Subscribe(WsEvents.CircuitUpdated, handler);

    public IDisposable OnCircuitDeleted(Action<CircuitDeletedEvent> handler) =>
        Subscribe(WsEvents.CircuitDeleted, handler);

    public IDisposable OnMetricsUpdate(Action<MetricsUpdateEvent> handler) =>
        Subscribe(WsEvents.MetricsUpdate, handler);

    public IDisposable OnReconnected(Action handler)
    {
        ArgumentNullException.ThrowIfNull(handler);
        lock (_reconnectedGate)
        {
            _reconnectedHandlers.Add(handler);
        }

        return new ReconnectedSubscription(this, handler);
    }

    public void Dispose()
    {
        _lifetime.Cancel();
        _lifetime.Dispose();
        _ = CloseAsync();
    }

    private IDisposable Subscribe<T>(string eventName, Action<T> handler)
    {
        ArgumentNullException.ThrowIfNull(handler);
        return _hub.On<JsonElement>(eventName, payload =>
        {
            T? parsed;
            try
            {
                parsed = payload.Deserialize<T>(Json);
            }
            catch (JsonException failure)
            {
                RealtimeLog.MalformedEvent(_logger, eventName, failure);
                return;
            }

            if (parsed is not null)
            {
                _post(() => handler(parsed));
            }
        });
    }

    private async Task ConnectLoopAsync()
    {
        var attempt = 0;
        while (!_lifetime.IsCancellationRequested)
        {
            try
            {
                await _hub.StartAsync(_lifetime.Token);
                RealtimeLog.Connected(_logger, _hubUrl);
                return;
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception failure) when (failure is not OutOfMemoryException)
            {
                // StartAsync surfaces the whole transport zoo (HTTP, WebSocket, IO,
                // negotiation); every one of them means the same thing: not yet.
                attempt++;
                var delay = SteadyRetryPolicy.Backoff(attempt);
                RealtimeLog.ConnectFailed(_logger, _hubUrl, delay.TotalSeconds, failure);
                try
                {
                    await Task.Delay(delay, _lifetime.Token);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
            }
        }
    }

    private async Task CloseAsync()
    {
        try
        {
            await _hub.DisposeAsync();
        }
        catch (Exception failure) when (failure is not OutOfMemoryException)
        {
            // Fire-and-forget teardown during sign-out or shutdown: log, never throw.
            RealtimeLog.DisposeFailed(_logger, failure);
        }
    }

    private sealed class ReconnectedSubscription(RealtimeConnection owner, Action handler) : IDisposable
    {
        public void Dispose()
        {
            lock (owner._reconnectedGate)
            {
                owner._reconnectedHandlers.Remove(handler);
            }
        }
    }

    /// <summary>
    /// Retries forever with a capped backoff. The default policy gives up after four tries,
    /// which for an always-on LAN appliance turns every long outage into a dead client.
    /// </summary>
    private sealed class SteadyRetryPolicy : IRetryPolicy
    {
        public static TimeSpan Backoff(long attempt) => attempt switch
        {
            <= 1 => TimeSpan.FromSeconds(1),
            2 => TimeSpan.FromSeconds(2),
            3 => TimeSpan.FromSeconds(5),
            4 => TimeSpan.FromSeconds(10),
            _ => TimeSpan.FromSeconds(30),
        };

        public TimeSpan? NextRetryDelay(RetryContext retryContext) =>
            Backoff(retryContext.PreviousRetryCount);
    }
}

/// <summary>Builds the production connection: real dispatcher, per-session logger.</summary>
internal sealed class RealtimeConnectionFactory(ILoggerFactory loggers) : IRealtimeConnectionFactory
{
    public IRealtimeConnection Create(Uri serverUrl, string bearerToken) =>
        new RealtimeConnection(
            serverUrl,
            bearerToken,
            loggers.CreateLogger<RealtimeConnection>(),
            action => Dispatcher.UIThread.Post(action));
}

internal static partial class RealtimeLog
{
    [LoggerMessage(Level = LogLevel.Information, Message = "Realtime connected to {HubUrl}")]
    public static partial void Connected(ILogger logger, Uri hubUrl);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Realtime connect to {HubUrl} failed; retrying in {DelaySeconds}s")]
    public static partial void ConnectFailed(ILogger logger, Uri hubUrl, double delaySeconds, Exception exception);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Realtime connection to {HubUrl} lost; reconnecting")]
    public static partial void Reconnecting(ILogger logger, Uri hubUrl, Exception? exception);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Ignoring a malformed {EventName} payload")]
    public static partial void MalformedEvent(ILogger logger, string eventName, Exception exception);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Realtime connection teardown failed")]
    public static partial void DisposeFailed(ILogger logger, Exception exception);
}
