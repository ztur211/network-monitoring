using System.Text.Json;
using NodeScope.Modules.Alerting.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Alerting.Application;

public sealed class AlertMetricEvaluator
{
    private readonly IAlertRepository _repository;
    private readonly IAlertInventoryScope _inventory;

    public AlertMetricEvaluator(IAlertRepository repository, IAlertInventoryScope inventory)
    {
        _repository = repository;
        _inventory = inventory;
    }

    public async Task EvaluateOnceAsync(DateTime nowUtc, CancellationToken cancellationToken)
    {
        var rules = await _repository.ListEnabledRulesAsync(
            AlertTrigger.MetricThreshold,
            organizationId: null,
            cancellationToken);
        foreach (var rule in rules)
        {
            if (rule.Metric is null || rule.Op is null || rule.Threshold is null
                || rule.ForSeconds is null)
            {
                continue;
            }

            var deviceIds = await _inventory.ResolveDeviceIdsAsync(
                rule.OrganizationId,
                rule.Scope.ToSelection(),
                cancellationToken);
            if (deviceIds is { Count: 0 })
            {
                continue;
            }

            var aggregates = await _repository.QuerySustainedMetricAsync(
                rule.OrganizationId,
                rule.Metric,
                rule.Op,
                deviceIds,
                nowUtc.AddSeconds(-rule.ForSeconds.Value),
                nowUtc,
                cancellationToken);
            foreach (var aggregate in aggregates)
            {
                var breached = rule.Op == "lt"
                    ? aggregate.Value < rule.Threshold.Value
                    : aggregate.Value > rule.Threshold.Value;
                var kind = breached
                    ? AlertEventKind.Firing
                    : rule.NotifyOnRecovery
                        ? AlertEventKind.Resolved
                        : (AlertEventKind?)null;
                if (kind is null)
                {
                    continue;
                }

                var detail = JsonSerializer.Serialize(new
                {
                    metric = "latencyMs",
                    op = rule.Op,
                    threshold = rule.Threshold,
                    value = aggregate.Value,
                    ruleName = rule.Name,
                });
                _ = await _repository.RecordTransitionAsync(
                    rule,
                    aggregate.DeviceId,
                    kind.Value,
                    detail,
                    nowUtc,
                    cancellationToken);
            }
        }
    }
}
