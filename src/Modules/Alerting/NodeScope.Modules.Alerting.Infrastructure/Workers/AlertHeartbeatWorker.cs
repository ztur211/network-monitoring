using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NodeScope.Modules.Alerting.Application;

namespace NodeScope.Modules.Alerting.Infrastructure.Workers;

internal sealed class AlertHeartbeatWorker : IHostedService, IDisposable
{
    private const long LockKey = 0x4e53414c48425431;
    private readonly IServiceScopeFactory _scopes;
    private readonly IHttpClientFactory _httpClients;
    private readonly PostgresCycleLock _cycleLock;
    private readonly AlertingOptions _options;
    private readonly TimeProvider _time;
    private readonly ILogger<AlertHeartbeatWorker> _logger;
    private readonly HostedWorkerLifetime _lifetime = new();

    public AlertHeartbeatWorker(
        IServiceScopeFactory scopes,
        IHttpClientFactory httpClients,
        PostgresCycleLock cycleLock,
        AlertingOptions options,
        TimeProvider time,
        ILogger<AlertHeartbeatWorker> logger)
    {
        _scopes = scopes;
        _httpClients = httpClients;
        _cycleLock = cycleLock;
        _options = options;
        _time = time;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken) =>
        _lifetime.StartAsync(RunAsync);

    public Task StopAsync(CancellationToken cancellationToken) =>
        _lifetime.StopAsync(cancellationToken);

    public void Dispose() => _lifetime.Dispose();

    private async Task RunAsync(CancellationToken stoppingToken)
    {
        if (_options.HeartbeatUrl is null)
        {
            return;
        }

        using var timer = new PeriodicTimer(_options.HeartbeatInterval, _time);
        try
        {
            do
            {
                try
                {
                    _ = await _cycleLock.TryRunAsync(
                        LockKey,
                        SendAsync,
                        stoppingToken);
                }
                catch (Exception failure) when (
                    failure is not OperationCanceledException || !stoppingToken.IsCancellationRequested)
                {
                    AlertWorkerLog.CycleFailed(_logger, "heartbeat", failure);
                }
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
    }

    private async Task SendAsync(CancellationToken cancellationToken)
    {
        await using var scope = _scopes.CreateAsyncScope();
        var counts = await scope.ServiceProvider.GetRequiredService<IAlertRepository>()
            .CountDeviceStatesAsync(cancellationToken);
        using var response = await _httpClients.CreateClient("NodeScopeAlerts")
            .PostAsJsonAsync(
                _options.HeartbeatUrl,
                new
                {
                    site = Environment.MachineName,
                    up = counts.Up,
                    down = counts.Down,
                    warning = counts.Warning,
                    unknown = counts.Unknown,
                    at = _time.GetUtcNow().UtcDateTime,
                },
                cancellationToken);
        response.EnsureSuccessStatusCode();
    }
}

internal static partial class AlertWorkerLog
{
    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Error,
        Message = "Alert {Cycle} cycle failed")]
    public static partial void CycleFailed(
        ILogger logger,
        string cycle,
        Exception exception);
}
