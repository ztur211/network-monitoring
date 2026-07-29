using System.Text.Json;
using Microsoft.Extensions.Logging;
using NodeScope.Modules.Alerting.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Alerting.Application;

public sealed class AlertEvaluator : IMonitoringAlertSink
{
    private readonly IAlertRepository _repository;
    private readonly IAlertInventoryScope _inventory;
    private readonly ILogger<AlertEvaluator> _logger;

    public AlertEvaluator(
        IAlertRepository repository,
        IAlertInventoryScope inventory,
        ILogger<AlertEvaluator> logger)
    {
        _repository = repository;
        _inventory = inventory;
        _logger = logger;
    }

    public async Task OnStatusChangedAsync(
        MonitoringStatusTransition transition,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(transition);
        var rules = await _repository.ListEnabledRulesAsync(
            AlertTrigger.StateTransition,
            transition.OrganizationId,
            cancellationToken);

        foreach (var rule in rules)
        {
            if (!await _inventory.ContainsAsync(
                    transition.OrganizationId,
                    rule.Scope.ToSelection(),
                    transition.DeviceId,
                    transition.NetworkId,
                    transition.PropertyId,
                    cancellationToken))
            {
                continue;
            }

            AlertEventKind? kind = null;
            if (rule.TargetStates.Contains(transition.State, StringComparer.Ordinal))
            {
                kind = AlertEventKind.Firing;
            }
            else if (transition.State == "UP" && rule.NotifyOnRecovery)
            {
                kind = AlertEventKind.Resolved;
            }

            if (kind is null)
            {
                continue;
            }

            var detail = JsonSerializer.Serialize(new
            {
                state = transition.State,
                previousState = transition.PreviousState,
                latencyMs = transition.LatencyMs,
                at = transition.At,
                ruleName = rule.Name,
            });
            var alertEvent = await _repository.RecordTransitionAsync(
                rule,
                transition.DeviceId,
                kind.Value,
                detail,
                transition.At,
                cancellationToken);
            if (alertEvent is not null)
            {
                if (_logger.IsEnabled(LogLevel.Information))
                {
                    AlertEvaluatorLog.Recorded(
                        _logger,
                        kind.Value,
                        rule.Id,
                        transition.DeviceId);
                }
            }
        }
    }
}

internal static partial class AlertEvaluatorLog
{
    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Information,
        Message = "Recorded {Kind} alert for rule {RuleId} and device {DeviceId}")]
    public static partial void Recorded(
        ILogger logger,
        AlertEventKind kind,
        string ruleId,
        string deviceId);
}
