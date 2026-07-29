using NodeScope.Modules.Alerting.Domain;

namespace NodeScope.Modules.Alerting.Application;

public sealed class AlertDeliveryService
{
    private readonly IAlertRepository _repository;
    private readonly IAlertChannelDispatcher _dispatcher;
    private readonly int _maxAttempts;

    public AlertDeliveryService(
        IAlertRepository repository,
        IAlertChannelDispatcher dispatcher,
        AlertingOptions options)
    {
        _repository = repository;
        _dispatcher = dispatcher;
        ArgumentNullException.ThrowIfNull(options);
        _maxAttempts = options.MaxAttempts;
    }

    public async Task DrainOnceAsync(DateTime nowUtc, CancellationToken cancellationToken)
    {
        var due = await _repository.ListDueDeliveriesAsync(nowUtc, 50, cancellationToken);
        var channels = (await _repository.FindChannelsAsync(
                due
                    .Where(delivery => delivery.ChannelId is not null)
                    .Select(delivery => delivery.ChannelId!)
                    .Distinct(StringComparer.Ordinal)
                    .ToList(),
                cancellationToken))
            .ToDictionary(channel => channel.Id, StringComparer.Ordinal);

        foreach (var delivery in due)
        {
            if (delivery.ChannelId is null
                || !channels.TryGetValue(delivery.ChannelId, out var channel)
                || !channel.Enabled)
            {
                await _repository.UpdateDeliveryAsync(
                    delivery.Id,
                    AlertDeliveryStatus.GaveUp,
                    delivery.Attempts,
                    nowUtc,
                    null,
                    "channel missing or disabled",
                    cancellationToken);
                continue;
            }

            try
            {
                await _dispatcher.DispatchAsync(channel, delivery.Event, cancellationToken);
                await _repository.UpdateDeliveryAsync(
                    delivery.Id,
                    AlertDeliveryStatus.Sent,
                    delivery.Attempts,
                    nowUtc,
                    null,
                    null,
                    cancellationToken);
            }
            catch (Exception failure) when (
                failure is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
                var attempts = delivery.Attempts + 1;
                var gaveUp = attempts >= _maxAttempts;
                await _repository.UpdateDeliveryAsync(
                    delivery.Id,
                    gaveUp ? AlertDeliveryStatus.GaveUp : AlertDeliveryStatus.Failed,
                    attempts,
                    nowUtc,
                    gaveUp ? null : nowUtc.Add(Backoff(attempts)),
                    LimitError(failure.Message),
                    cancellationToken);
            }
        }
    }

    public static TimeSpan Backoff(int attempts)
    {
        var exponent = Math.Clamp(attempts, 0, 20);
        return TimeSpan.FromMilliseconds(Math.Min(5_000d * Math.Pow(2, exponent), 3_600_000d));
    }

    private static string LimitError(string error) =>
        error.Length <= 2000 ? error : error[..2000];
}

public sealed record AlertingOptions(
    TimeSpan EvaluationInterval,
    TimeSpan DeliveryInterval,
    int MaxAttempts,
    Uri? HeartbeatUrl,
    TimeSpan HeartbeatInterval)
{
    public static AlertingOptions From(Func<string, string?> read)
    {
        ArgumentNullException.ThrowIfNull(read);
        return new AlertingOptions(
            TimeSpan.FromSeconds(PositiveInt(read("ALERT_EVAL_INTERVAL_SECONDS"), 60)),
            TimeSpan.FromSeconds(PositiveInt(read("ALERT_DELIVER_INTERVAL_SECONDS"), 15)),
            PositiveInt(read("ALERT_MAX_ATTEMPTS"), 10),
            Uri.TryCreate(read("ALERT_HEARTBEAT_URL"), UriKind.Absolute, out var heartbeat)
                && heartbeat.Scheme is "http" or "https"
                    ? heartbeat
                    : null,
            TimeSpan.FromSeconds(PositiveInt(read("ALERT_HEARTBEAT_INTERVAL_SECONDS"), 60)));
    }

    private static int PositiveInt(string? value, int fallback) =>
        int.TryParse(value, out var parsed) && parsed > 0 ? parsed : fallback;
}
