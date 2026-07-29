using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Modules.Alerting.Application;
using NodeScope.Modules.Alerting.Domain;
using NodeScope.Platform.Abstractions;
using Xunit;

namespace NodeScope.Alerting.Tests;

public sealed class AlertEngineTests
{
    private static readonly DateTime Now = new(2026, 7, 29, 5, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task State_evaluator_records_firing_for_a_matching_transition()
    {
        var repository = new FakeRepository
        {
            Rules = [Rule(AlertTrigger.StateTransition, targetStates: ["DOWN"])],
        };
        var evaluator = new AlertEvaluator(
            repository,
            new FakeInventoryScope(contains: true),
            NullLogger<AlertEvaluator>.Instance);

        await evaluator.OnStatusChangedAsync(
            new MonitoringStatusTransition(
                "org-1", "device-1", "network-1", "property-1",
                "UP", "DOWN", 20, Now),
            CancellationToken.None);

        var recorded = Assert.Single(repository.Recorded);
        Assert.Equal(AlertEventKind.Firing, recorded.Kind);
        Assert.Equal("device-1", recorded.DeviceId);
    }

    [Fact]
    public async Task State_evaluator_does_not_leak_across_inventory_scope()
    {
        var repository = new FakeRepository
        {
            Rules = [Rule(AlertTrigger.StateTransition, targetStates: ["DOWN"])],
        };
        var evaluator = new AlertEvaluator(
            repository,
            new FakeInventoryScope(contains: false),
            NullLogger<AlertEvaluator>.Instance);

        await evaluator.OnStatusChangedAsync(
            new MonitoringStatusTransition(
                "org-1", "device-1", "network-1", "property-1",
                "UP", "DOWN", 20, Now),
            CancellationToken.None);

        Assert.Empty(repository.Recorded);
    }

    [Fact]
    public async Task State_evaluator_records_one_recovery_when_enabled()
    {
        var repository = new FakeRepository
        {
            Rules = [Rule(AlertTrigger.StateTransition, targetStates: ["DOWN"], notifyOnRecovery: true)],
        };
        var evaluator = new AlertEvaluator(
            repository,
            new FakeInventoryScope(contains: true),
            NullLogger<AlertEvaluator>.Instance);

        await evaluator.OnStatusChangedAsync(
            new MonitoringStatusTransition(
                "org-1", "device-1", "network-1", "property-1",
                "DOWN", "UP", 12, Now),
            CancellationToken.None);

        Assert.Equal(AlertEventKind.Resolved, Assert.Single(repository.Recorded).Kind);
    }

    [Theory]
    [InlineData("gt", 501, 500, true)]
    [InlineData("gt", 499, 500, false)]
    [InlineData("lt", 9, 10, true)]
    [InlineData("lt", 11, 10, false)]
    public async Task Metric_evaluator_applies_sustained_aggregate_operator(
        string op,
        double value,
        double threshold,
        bool firing)
    {
        var repository = new FakeRepository
        {
            Rules =
            [
                Rule(
                    AlertTrigger.MetricThreshold,
                    op: op,
                    threshold: threshold,
                    notifyOnRecovery: true),
            ],
            Metrics = [new MetricAggregate("device-1", value)],
        };
        var evaluator = new AlertMetricEvaluator(
            repository,
            new FakeInventoryScope(contains: true));

        await evaluator.EvaluateOnceAsync(Now, CancellationToken.None);

        var recorded = Assert.Single(repository.Recorded);
        Assert.Equal(
            firing ? AlertEventKind.Firing : AlertEventKind.Resolved,
            recorded.Kind);
    }

    [Fact]
    public async Task Delivery_failure_retries_with_exponential_backoff()
    {
        var repository = new FakeRepository
        {
            Due = [Delivery()],
            Channels = [Channel()],
        };
        var delivery = new AlertDeliveryService(
            repository,
            new FakeDispatcher(failuresBeforeSuccess: 1),
            Options(maxAttempts: 10));

        await delivery.DrainOnceAsync(Now, CancellationToken.None);

        var update = Assert.Single(repository.DeliveryUpdates);
        Assert.Equal(AlertDeliveryStatus.Failed, update.Status);
        Assert.Equal(1, update.Attempts);
        Assert.Equal(Now.AddSeconds(10), update.NextAttemptAt);
    }

    [Fact]
    public async Task Delivery_that_recovers_is_marked_sent()
    {
        var repository = new FakeRepository
        {
            Due = [Delivery()],
            Channels = [Channel()],
        };
        var dispatcher = new FakeDispatcher(failuresBeforeSuccess: 1);
        var delivery = new AlertDeliveryService(repository, dispatcher, Options(maxAttempts: 10));

        await delivery.DrainOnceAsync(Now, CancellationToken.None);
        repository.DeliveryUpdates.Clear();
        await delivery.DrainOnceAsync(Now.AddMinutes(1), CancellationToken.None);

        Assert.Equal(AlertDeliveryStatus.Sent, Assert.Single(repository.DeliveryUpdates).Status);
    }

    [Fact]
    public async Task Delivery_stops_retrying_at_the_attempt_limit()
    {
        var repository = new FakeRepository
        {
            Due = [Delivery(attempts: 2)],
            Channels = [Channel()],
        };
        var delivery = new AlertDeliveryService(
            repository,
            new FakeDispatcher(failuresBeforeSuccess: int.MaxValue),
            Options(maxAttempts: 3));

        await delivery.DrainOnceAsync(Now, CancellationToken.None);

        var update = Assert.Single(repository.DeliveryUpdates);
        Assert.Equal(AlertDeliveryStatus.GaveUp, update.Status);
        Assert.Null(update.NextAttemptAt);
    }

    [Fact]
    public async Task Delivery_whose_channel_was_deleted_is_marked_gave_up()
    {
        var repository = new FakeRepository
        {
            Due = [Delivery(channelId: null)],
        };
        var delivery = new AlertDeliveryService(
            repository,
            new FakeDispatcher(failuresBeforeSuccess: 0),
            Options(maxAttempts: 10));

        await delivery.DrainOnceAsync(Now, CancellationToken.None);

        var update = Assert.Single(repository.DeliveryUpdates);
        Assert.Equal(AlertDeliveryStatus.GaveUp, update.Status);
        Assert.Equal(0, update.Attempts);
        Assert.Null(update.NextAttemptAt);
    }

    private static AlertRuleRecord Rule(
        AlertTrigger trigger,
        IReadOnlyList<string>? targetStates = null,
        string op = "gt",
        double threshold = 500,
        bool notifyOnRecovery = false) =>
        new(
            "rule-1",
            "org-1",
            "Rule",
            true,
            trigger,
            new AlertScope(true, [], [], []),
            targetStates ?? [],
            trigger == AlertTrigger.MetricThreshold ? "latency_ms" : null,
            trigger == AlertTrigger.MetricThreshold ? op : null,
            trigger == AlertTrigger.MetricThreshold ? threshold : null,
            trigger == AlertTrigger.MetricThreshold ? 60 : null,
            AlertSeverity.Critical,
            ["channel-1"],
            60,
            notifyOnRecovery,
            1,
            Now,
            Now);

    private static AlertChannelRecord Channel() =>
        new(
            "channel-1",
            "org-1",
            AlertChannelType.Inapp,
            "In app",
            true,
            "{}",
            null,
            1,
            Now,
            Now);

    private static AlertDeliveryRecord Delivery(int attempts = 0, string? channelId = "channel-1")
    {
        var alertEvent = new AlertEventRecord(
            "event-1",
            "org-1",
            "rule-1",
            "Rule",
            "device-1",
            AlertEventKind.Firing,
            AlertSeverity.Critical,
            "{}",
            "rule-1:device-1",
            Now);
        return new AlertDeliveryRecord(
            "delivery-1",
            alertEvent.Id,
            channelId,
            AlertDeliveryStatus.Pending,
            attempts,
            null,
            Now,
            null,
            alertEvent);
    }

    private static AlertingOptions Options(int maxAttempts) =>
        new(
            TimeSpan.FromMinutes(1),
            TimeSpan.FromSeconds(15),
            maxAttempts,
            null,
            TimeSpan.FromMinutes(1));

    private sealed class FakeInventoryScope(bool contains) : IAlertInventoryScope
    {
        public Task<bool> ContainsAsync(
            string organizationId,
            AlertScopeSelection scope,
            string deviceId,
            string networkId,
            string propertyId,
            CancellationToken cancellationToken) =>
            Task.FromResult(contains);

        public Task<IReadOnlyList<string>?> ResolveDeviceIdsAsync(
            string organizationId,
            AlertScopeSelection scope,
            CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<string>?>(null);
    }

    private sealed class FakeDispatcher(int failuresBeforeSuccess) : IAlertChannelDispatcher
    {
        private int _attempts;

        public Task DispatchAsync(
            AlertChannelRecord channel,
            AlertEventRecord alertEvent,
            CancellationToken cancellationToken)
        {
            if (_attempts++ < failuresBeforeSuccess)
            {
                throw new HttpRequestException("offline");
            }

            return Task.CompletedTask;
        }
    }

    private sealed class FakeRepository : IAlertRepository
    {
        public IReadOnlyList<AlertRuleRecord> Rules { get; init; } = [];

        public IReadOnlyList<MetricAggregate> Metrics { get; init; } = [];

        public IReadOnlyList<AlertDeliveryRecord> Due { get; init; } = [];

        public IReadOnlyList<AlertChannelRecord> Channels { get; init; } = [];

        public List<(string DeviceId, AlertEventKind Kind)> Recorded { get; } = [];

        public List<(AlertDeliveryStatus Status, int Attempts, DateTime? NextAttemptAt)> DeliveryUpdates { get; } = [];

        public Task<IReadOnlyList<AlertRuleRecord>> ListEnabledRulesAsync(
            AlertTrigger trigger,
            string? organizationId,
            CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<AlertRuleRecord>>(
                [.. Rules.Where(rule => rule.Trigger == trigger)]);

        public Task<AlertEventRecord?> RecordTransitionAsync(
            AlertRuleRecord rule,
            string deviceId,
            AlertEventKind kind,
            string detailJson,
            DateTime nowUtc,
            CancellationToken cancellationToken)
        {
            Recorded.Add((deviceId, kind));
            return Task.FromResult<AlertEventRecord?>(
                new AlertEventRecord(
                    Guid.NewGuid().ToString(),
                    rule.OrganizationId,
                    rule.Id,
                    rule.Name,
                    deviceId,
                    kind,
                    rule.Severity,
                    detailJson,
                    $"{rule.Id}:{deviceId}",
                    nowUtc));
        }

        public Task<IReadOnlyList<MetricAggregate>> QuerySustainedMetricAsync(
            string organizationId,
            string metric,
            string op,
            IReadOnlyList<string>? deviceIds,
            DateTime sinceUtc,
            DateTime nowUtc,
            CancellationToken cancellationToken) =>
            Task.FromResult(Metrics);

        public Task<IReadOnlyList<AlertDeliveryRecord>> ListDueDeliveriesAsync(
            DateTime nowUtc,
            int take,
            CancellationToken cancellationToken) =>
            Task.FromResult(Due);

        public Task<IReadOnlyList<AlertChannelRecord>> FindChannelsAsync(
            IReadOnlyCollection<string> channelIds,
            CancellationToken cancellationToken) =>
            Task.FromResult(Channels);

        public Task UpdateDeliveryAsync(
            string deliveryId,
            AlertDeliveryStatus status,
            int attempts,
            DateTime? lastAttemptAt,
            DateTime? nextAttemptAt,
            string? lastError,
            CancellationToken cancellationToken)
        {
            DeliveryUpdates.Add((status, attempts, nextAttemptAt));
            return Task.CompletedTask;
        }

        public Task<AlertChannelRecord> CreateChannelAsync(
            NewAlertChannel channel,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<AlertChannelRecord>> ListChannelsAsync(
            string organizationId,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<AlertChannelRecord?> FindChannelAsync(
            string organizationId,
            string channelId,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<bool> DeleteChannelAsync(
            string organizationId,
            string channelId,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<AlertRuleRecord> CreateRuleAsync(
            NewAlertRule rule,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<AlertRuleRecord>> ListRulesAsync(
            string organizationId,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<bool> DeleteRuleAsync(
            string organizationId,
            string ruleId,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<AlertEventRecord>> ListEventsAsync(
            string organizationId,
            int take,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<(int Up, int Down, int Warning, int Unknown)> CountDeviceStatesAsync(
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();
    }
}
