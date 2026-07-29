namespace NodeScope.Modules.Alerting.Infrastructure.Workers;

/// <summary>
/// Owns the cancellation and observed task for a composed hosted-service loop.
/// Alert workers implement the framework interface directly, per Decision 6.
/// </summary>
internal sealed class HostedWorkerLifetime : IDisposable
{
    private readonly CancellationTokenSource _stopping = new();
    private Task? _loop;

    public Task StartAsync(Func<CancellationToken, Task> run)
    {
        ArgumentNullException.ThrowIfNull(run);
        _loop = run(_stopping.Token);
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        await _stopping.CancelAsync();
        if (_loop is not null)
        {
            await _loop.WaitAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    public void Dispose() => _stopping.Dispose();
}
