using System.Text.Json;
using Microsoft.Extensions.Logging;
using NodeScope.Modules.Alerting.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Alerting.Application;

public sealed class AlertsService
{
    private readonly IAlertRepository _repository;
    private readonly IAlertChannelDispatcher _dispatcher;
    private readonly ISecretCipher _cipher;
    private readonly ILogger<AlertsService> _logger;

    public AlertsService(
        IAlertRepository repository,
        IAlertChannelDispatcher dispatcher,
        ISecretCipher cipher,
        ILogger<AlertsService> logger)
    {
        _repository = repository;
        _dispatcher = dispatcher;
        _cipher = cipher;
        _logger = logger;
    }

    public async Task<AlertChannelDto> CreateChannelAsync(
        string organizationId,
        CreateAlertChannelRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var channel = await _repository.CreateChannelAsync(
            new NewAlertChannel(
                organizationId,
                AlertLabels.ParseChannelType(request.Type)!.Value,
                request.Name!.Trim(),
                request.Enabled ?? true,
                request.Config?.GetRawText() ?? "{}",
                string.IsNullOrEmpty(request.Secret) ? null : _cipher.Encrypt(request.Secret)),
            cancellationToken);
        return ToDto(channel);
    }

    public async Task<IReadOnlyList<AlertChannelDto>> ListChannelsAsync(
        string organizationId,
        CancellationToken cancellationToken) =>
        [.. (await _repository.ListChannelsAsync(organizationId, cancellationToken)).Select(ToDto)];

    public async Task DeleteChannelAsync(
        string organizationId,
        string channelId,
        CancellationToken cancellationToken)
    {
        if (!await _repository.DeleteChannelAsync(organizationId, channelId, cancellationToken))
        {
            throw new ApiException("ALERT_003", "CHANNEL_NOT_FOUND", 404);
        }
    }

    public async Task TestChannelAsync(
        string organizationId,
        string channelId,
        CancellationToken cancellationToken)
    {
        var channel = await _repository.FindChannelAsync(organizationId, channelId, cancellationToken)
            ?? throw new ApiException("ALERT_003", "CHANNEL_NOT_FOUND", 404);
        var now = DateTime.UtcNow;
        try
        {
            await _dispatcher.DispatchAsync(
                channel,
                new AlertEventRecord(
                    "test",
                    organizationId,
                    null,
                    "Test notification",
                    null,
                    AlertEventKind.Firing,
                    AlertSeverity.Info,
                    """{"test":true,"ruleName":"Test notification"}""",
                    "test",
                    now),
                cancellationToken);
        }
        catch (Exception failure) when (
            failure is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            AlertServiceLog.ChannelTestFailed(_logger, channel.Id, channel.Type.ToString(), failure);
            throw new ApiException("ALERT_007", "CHANNEL_TEST_FAILED", 502);
        }
    }

    public async Task<AlertRuleDto> CreateRuleAsync(
        string organizationId,
        CreateAlertRuleRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var requestedChannels = request.ChannelIds!
            .Distinct(StringComparer.Ordinal)
            .ToList();
        var channels = await _repository.FindChannelsAsync(requestedChannels, cancellationToken);
        if (channels.Count != requestedChannels.Count
            || channels.Any(channel => channel.OrganizationId != organizationId))
        {
            throw new ApiException("ALERT_001", "CHANNEL_NOT_FOUND", 400);
        }

        var trigger = AlertLabels.ParseTrigger(request.Trigger)!.Value;
        var rule = await _repository.CreateRuleAsync(
            new NewAlertRule(
                organizationId,
                request.Name!.Trim(),
                request.Enabled ?? true,
                trigger,
                request.Scope!.Validate([])!,
                trigger == AlertTrigger.StateTransition
                    ? [.. request.TargetStates!.Distinct(StringComparer.Ordinal)]
                    : [],
                trigger == AlertTrigger.MetricThreshold ? "latency_ms" : null,
                trigger == AlertTrigger.MetricThreshold ? request.Op : null,
                trigger == AlertTrigger.MetricThreshold ? request.Threshold : null,
                trigger == AlertTrigger.MetricThreshold ? request.ForSeconds : null,
                AlertLabels.ParseSeverity(request.Severity)!.Value,
                requestedChannels,
                request.CooldownSeconds!.Value,
                request.NotifyOnRecovery!.Value),
            cancellationToken);
        return ToDto(rule);
    }

    public async Task<IReadOnlyList<AlertRuleDto>> ListRulesAsync(
        string organizationId,
        CancellationToken cancellationToken) =>
        [.. (await _repository.ListRulesAsync(organizationId, cancellationToken)).Select(ToDto)];

    public async Task DeleteRuleAsync(
        string organizationId,
        string ruleId,
        CancellationToken cancellationToken)
    {
        if (!await _repository.DeleteRuleAsync(organizationId, ruleId, cancellationToken))
        {
            throw new ApiException("ALERT_004", "RULE_NOT_FOUND", 404);
        }
    }

    public async Task<IReadOnlyList<AlertEventDto>> ListEventsAsync(
        string organizationId,
        int take,
        CancellationToken cancellationToken) =>
        [.. (await _repository.ListEventsAsync(organizationId, take, cancellationToken)).Select(ToDto)];

    private static AlertChannelDto ToDto(AlertChannelRecord channel) => new(
        channel.Id,
        channel.OrganizationId,
        AlertLabels.Of(channel.Type),
        channel.Name,
        channel.Enabled,
        ParseJson(channel.ConfigJson),
        channel.Version,
        channel.CreatedAt,
        channel.UpdatedAt);

    private static AlertRuleDto ToDto(AlertRuleRecord rule) => new(
        rule.Id,
        rule.OrganizationId,
        rule.Name,
        rule.Enabled,
        AlertLabels.Of(rule.Trigger),
        AlertScopeDto.From(rule.Scope),
        rule.TargetStates,
        rule.Metric == "latency_ms" ? "latencyMs" : rule.Metric,
        rule.Op,
        rule.Threshold,
        rule.ForSeconds,
        AlertLabels.Of(rule.Severity),
        rule.ChannelIds,
        rule.CooldownSeconds,
        rule.NotifyOnRecovery,
        rule.Version,
        rule.CreatedAt,
        rule.UpdatedAt);

    private static AlertEventDto ToDto(AlertEventRecord alertEvent) => new(
        alertEvent.Id,
        alertEvent.OrganizationId,
        alertEvent.RuleId,
        alertEvent.RuleName,
        alertEvent.DeviceId,
        AlertLabels.Of(alertEvent.Kind),
        AlertLabels.Of(alertEvent.Severity),
        ParseJson(alertEvent.DetailJson),
        alertEvent.DedupKey,
        alertEvent.CreatedAt);

    private static JsonElement ParseJson(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }
}

internal static partial class AlertServiceLog
{
    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Alert channel test failed for channel {ChannelId} ({ChannelType})")]
    public static partial void ChannelTestFailed(
        ILogger logger,
        string channelId,
        string channelType,
        Exception exception);
}
