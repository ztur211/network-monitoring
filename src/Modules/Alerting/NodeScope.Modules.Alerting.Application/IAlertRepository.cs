using NodeScope.Modules.Alerting.Domain;

namespace NodeScope.Modules.Alerting.Application;

public interface IAlertRepository
{
    public Task<AlertChannelRecord> CreateChannelAsync(
        NewAlertChannel channel,
        CancellationToken cancellationToken);

    public Task<IReadOnlyList<AlertChannelRecord>> ListChannelsAsync(
        string organizationId,
        CancellationToken cancellationToken);

    public Task<AlertChannelRecord?> FindChannelAsync(
        string organizationId,
        string channelId,
        CancellationToken cancellationToken);

    public Task<bool> DeleteChannelAsync(
        string organizationId,
        string channelId,
        CancellationToken cancellationToken);

    public Task<AlertRuleRecord> CreateRuleAsync(
        NewAlertRule rule,
        CancellationToken cancellationToken);

    public Task<IReadOnlyList<AlertRuleRecord>> ListRulesAsync(
        string organizationId,
        CancellationToken cancellationToken);

    public Task<IReadOnlyList<AlertRuleRecord>> ListEnabledRulesAsync(
        AlertTrigger trigger,
        string? organizationId,
        CancellationToken cancellationToken);

    public Task<bool> DeleteRuleAsync(
        string organizationId,
        string ruleId,
        CancellationToken cancellationToken);

    public Task<IReadOnlyList<AlertEventRecord>> ListEventsAsync(
        string organizationId,
        int take,
        CancellationToken cancellationToken);

    /// <summary>
    /// Atomically changes the incident state, writes an event, and enqueues its deliveries.
    /// Returns null when already in that state or a firing is inside its cooldown.
    /// </summary>
    public Task<AlertEventRecord?> RecordTransitionAsync(
        AlertRuleRecord rule,
        string deviceId,
        AlertEventKind kind,
        string detailJson,
        DateTime nowUtc,
        CancellationToken cancellationToken);

    public Task<IReadOnlyList<MetricAggregate>> QuerySustainedMetricAsync(
        string organizationId,
        string metric,
        string op,
        IReadOnlyList<string>? deviceIds,
        DateTime sinceUtc,
        DateTime nowUtc,
        CancellationToken cancellationToken);

    public Task<IReadOnlyList<AlertDeliveryRecord>> ListDueDeliveriesAsync(
        DateTime nowUtc,
        int take,
        CancellationToken cancellationToken);

    public Task<IReadOnlyList<AlertChannelRecord>> FindChannelsAsync(
        IReadOnlyCollection<string> channelIds,
        CancellationToken cancellationToken);

    public Task UpdateDeliveryAsync(
        string deliveryId,
        AlertDeliveryStatus status,
        int attempts,
        DateTime? lastAttemptAt,
        DateTime? nextAttemptAt,
        string? lastError,
        CancellationToken cancellationToken);

    public Task<(int Up, int Down, int Warning, int Unknown)> CountDeviceStatesAsync(
        CancellationToken cancellationToken);
}

public interface IAlertChannelDispatcher
{
    public Task DispatchAsync(
        AlertChannelRecord channel,
        AlertEventRecord alertEvent,
        CancellationToken cancellationToken);
}
