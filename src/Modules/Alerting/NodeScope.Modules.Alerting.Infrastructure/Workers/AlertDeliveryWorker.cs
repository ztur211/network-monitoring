using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NodeScope.Modules.Alerting.Application;

namespace NodeScope.Modules.Alerting.Infrastructure.Workers;

internal sealed class AlertDeliveryWorker : IHostedService, IDisposable
{
    private const long LockKey = 0x4e53414c444c5652;
    private readonly IServiceScopeFactory _scopes;
    private readonly PostgresCycleLock _cycleLock;
    private readonly AlertingOptions _options;
    private readonly TimeProvider _time;
    private readonly ILogger<AlertDeliveryWorker> _logger;
    private readonly HostedWorkerLifetime _lifetime = new();

    public AlertDeliveryWorker(
        IServiceScopeFactory scopes,
        PostgresCycleLock cycleLock,
        AlertingOptions options,
        TimeProvider time,
        ILogger<AlertDeliveryWorker> logger)
    {
        _scopes = scopes;
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
        using var timer = new PeriodicTimer(_options.DeliveryInterval, _time);
        try
        {
            do
            {
                try
                {
                    _ = await _cycleLock.TryRunAsync(
                        LockKey,
                        async cancellationToken =>
                        {
                            await using var scope = _scopes.CreateAsyncScope();
                            await scope.ServiceProvider.GetRequiredService<AlertDeliveryService>()
                                .DrainOnceAsync(_time.GetUtcNow().UtcDateTime, cancellationToken);
                        },
                        stoppingToken);
                }
                catch (Exception failure) when (
                    failure is not OperationCanceledException || !stoppingToken.IsCancellationRequested)
                {
                    AlertWorkerLog.CycleFailed(_logger, "delivery", failure);
                }
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
    }
}
