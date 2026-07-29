using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Alerting.Application;
using NodeScope.Modules.Alerting.Domain;
using NodeScope.Platform.Abstractions;
using Npgsql;

namespace NodeScope.Modules.Alerting.Infrastructure.Persistence;

internal sealed class AlertRepository : IAlertRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly AlertingDbContext _db;

    public AlertRepository(AlertingDbContext db)
    {
        _db = db;
    }

    public async Task<AlertChannelRecord> CreateChannelAsync(
        NewAlertChannel channel,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(channel);
        var now = DateTime.UtcNow;
        var row = new AlertChannelRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = channel.OrganizationId,
            Type = channel.Type,
            Name = channel.Name,
            Enabled = channel.Enabled,
            ConfigJson = channel.ConfigJson,
            SecretEnc = channel.SecretEnc,
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.Channels.Add(row);
        await SaveUniqueAsync("ALERT_005", "CHANNEL_NAME_ALREADY_EXISTS", cancellationToken);
        return ToRecord(row);
    }

    public async Task<IReadOnlyList<AlertChannelRecord>> ListChannelsAsync(
        string organizationId,
        CancellationToken cancellationToken) =>
        [.. (await _db.Channels.AsNoTracking()
                .Where(row => row.OrganizationId == organizationId)
                .OrderBy(row => row.CreatedAt)
                .ToListAsync(cancellationToken))
            .Select(ToRecord)];

    public async Task<AlertChannelRecord?> FindChannelAsync(
        string organizationId,
        string channelId,
        CancellationToken cancellationToken)
    {
        var row = await _db.Channels.AsNoTracking()
            .SingleOrDefaultAsync(
                channel => channel.Id == channelId && channel.OrganizationId == organizationId,
                cancellationToken);
        return row is null ? null : ToRecord(row);
    }

    public async Task<bool> DeleteChannelAsync(
        string organizationId,
        string channelId,
        CancellationToken cancellationToken)
    {
        var row = await _db.Channels.SingleOrDefaultAsync(
            channel => channel.Id == channelId && channel.OrganizationId == organizationId,
            cancellationToken);
        if (row is null)
        {
            return false;
        }

        if (await _db.RuleChannels.AnyAsync(link => link.ChannelId == channelId, cancellationToken))
        {
            throw new ApiException("ALERT_002", "CHANNEL_IN_USE", 409);
        }

        _db.Channels.Remove(row);
        try
        {
            await _db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (
            exception.InnerException is PostgresException
            {
                SqlState: PostgresErrorCodes.ForeignKeyViolation,
            })
        {
            throw new ApiException("ALERT_002", "CHANNEL_IN_USE", 409);
        }

        return true;
    }

    public async Task<AlertRuleRecord> CreateRuleAsync(
        NewAlertRule rule,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(rule);
        var now = DateTime.UtcNow;
        var row = new AlertRuleRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = rule.OrganizationId,
            Name = rule.Name,
            Enabled = rule.Enabled,
            Trigger = rule.Trigger,
            ScopeJson = JsonSerializer.Serialize(AlertScopeDto.From(rule.Scope), JsonOptions),
            TargetStates = [.. rule.TargetStates],
            Metric = rule.Metric,
            Op = rule.Op,
            Threshold = rule.Threshold,
            ForSeconds = rule.ForSeconds,
            Severity = rule.Severity,
            CooldownSeconds = rule.CooldownSeconds,
            NotifyOnRecovery = rule.NotifyOnRecovery,
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        foreach (var channelId in rule.ChannelIds)
        {
            row.Channels.Add(new AlertRuleChannelRow { RuleId = row.Id, ChannelId = channelId });
        }

        _db.Rules.Add(row);
        try
        {
            await _db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (
            exception.InnerException is PostgresException
            {
                SqlState: PostgresErrorCodes.UniqueViolation,
            })
        {
            throw new ApiException("ALERT_006", "RULE_NAME_ALREADY_EXISTS", 409);
        }
        catch (DbUpdateException exception) when (
            exception.InnerException is PostgresException
            {
                SqlState: PostgresErrorCodes.ForeignKeyViolation,
            })
        {
            throw new ApiException("ALERT_001", "CHANNEL_NOT_FOUND", 400);
        }

        return ToRecord(row);
    }

    public async Task<IReadOnlyList<AlertRuleRecord>> ListRulesAsync(
        string organizationId,
        CancellationToken cancellationToken) =>
        [.. (await _db.Rules.AsNoTracking()
                .Include(rule => rule.Channels)
                .Where(rule => rule.OrganizationId == organizationId)
                .OrderBy(rule => rule.CreatedAt)
                .ToListAsync(cancellationToken))
            .Select(ToRecord)];

    public async Task<IReadOnlyList<AlertRuleRecord>> ListEnabledRulesAsync(
        AlertTrigger trigger,
        string? organizationId,
        CancellationToken cancellationToken)
    {
        var query = _db.Rules.AsNoTracking()
            .Include(rule => rule.Channels)
            .Where(rule => rule.Enabled && rule.Trigger == trigger);
        if (organizationId is not null)
        {
            query = query.Where(rule => rule.OrganizationId == organizationId);
        }

        return [.. (await query.OrderBy(rule => rule.Id).ToListAsync(cancellationToken)).Select(ToRecord)];
    }

    public async Task<bool> DeleteRuleAsync(
        string organizationId,
        string ruleId,
        CancellationToken cancellationToken)
    {
        var row = await _db.Rules.SingleOrDefaultAsync(
            rule => rule.Id == ruleId && rule.OrganizationId == organizationId,
            cancellationToken);
        if (row is null)
        {
            return false;
        }

        _db.Rules.Remove(row);
        await _db.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<IReadOnlyList<AlertEventRecord>> ListEventsAsync(
        string organizationId,
        int take,
        CancellationToken cancellationToken) =>
        [.. (await _db.Events.AsNoTracking()
                .Where(alertEvent => alertEvent.OrganizationId == organizationId)
                .OrderByDescending(alertEvent => alertEvent.CreatedAt)
                .ThenByDescending(alertEvent => alertEvent.Id)
                .Take(take)
                .ToListAsync(cancellationToken))
            .Select(ToRecord)];

    public async Task<AlertEventRecord?> RecordTransitionAsync(
        AlertRuleRecord rule,
        string deviceId,
        AlertEventKind kind,
        string detailJson,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(rule);
        var dedupKey = $"{rule.Id}:{deviceId}";
        await using var transaction = await _db.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            cancellationToken);
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock(hashtextextended({dedupKey}, 0))",
            cancellationToken);

        var incident = await _db.Incidents.SingleOrDefaultAsync(
            row => row.DedupKey == dedupKey,
            cancellationToken);
        if (kind == AlertEventKind.Firing)
        {
            if (incident?.IsOpen == true
                || incident?.LastFiredAt is { } lastFired
                && nowUtc < lastFired.AddSeconds(rule.CooldownSeconds))
            {
                await transaction.CommitAsync(cancellationToken);
                return null;
            }

            if (incident is null)
            {
                incident = new AlertIncidentRow
                {
                    DedupKey = dedupKey,
                    OrganizationId = rule.OrganizationId,
                    RuleId = rule.Id,
                    DeviceId = deviceId,
                };
                _db.Incidents.Add(incident);
            }

            incident.IsOpen = true;
            incident.LastFiredAt = nowUtc;
            incident.UpdatedAt = nowUtc;
        }
        else
        {
            if (incident?.IsOpen != true)
            {
                await transaction.CommitAsync(cancellationToken);
                return null;
            }

            incident.IsOpen = false;
            incident.LastResolvedAt = nowUtc;
            incident.UpdatedAt = nowUtc;
        }

        var eventRow = new AlertEventRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = rule.OrganizationId,
            RuleId = rule.Id,
            RuleName = rule.Name,
            DeviceId = deviceId,
            Kind = kind,
            Severity = rule.Severity,
            DetailJson = detailJson,
            DedupKey = dedupKey,
            CreatedAt = nowUtc,
        };
        _db.Events.Add(eventRow);
        foreach (var channelId in rule.ChannelIds)
        {
            _db.Deliveries.Add(new AlertDeliveryRow
            {
                Id = Guid.NewGuid().ToString(),
                AlertEventId = eventRow.Id,
                ChannelId = channelId,
                Status = AlertDeliveryStatus.Pending,
                Attempts = 0,
                NextAttemptAt = nowUtc,
                CreatedAt = nowUtc,
            });
        }

        await _db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return ToRecord(eventRow);
    }

    public async Task<IReadOnlyList<MetricAggregate>> QuerySustainedMetricAsync(
        string organizationId,
        string metric,
        string op,
        IReadOnlyList<string>? deviceIds,
        DateTime sinceUtc,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        var window = nowUtc - sinceUtc;
        var boundaryFloorUtc = sinceUtc - window;
        var query = deviceIds is null
            ? _db.Database.SqlQuery<MetricAggregate>(
                $"""
                WITH "BoundarySamples" AS (
                    SELECT DISTINCT ON ("deviceId") "deviceId", "value", "time"
                    FROM "MonitoringMetric"
                    WHERE "organizationId" = {organizationId}
                      AND "metric" = {metric}
                      AND "time" >= {boundaryFloorUtc}
                      AND "time" < {sinceUtc}
                    ORDER BY "deviceId", "time" DESC
                ),
                "WindowSamples" AS (
                    SELECT "deviceId", "value", "time"
                    FROM "MonitoringMetric"
                    WHERE "organizationId" = {organizationId}
                      AND "metric" = {metric}
                      AND "time" >= {sinceUtc}
                      AND "time" <= {nowUtc}
                ),
                "Samples" AS (
                    SELECT * FROM "BoundarySamples"
                    UNION ALL
                    SELECT * FROM "WindowSamples"
                )
                SELECT "deviceId" AS "DeviceId",
                       CASE WHEN {op} = 'lt' THEN MAX("value") ELSE MIN("value") END AS "Value"
                FROM "Samples"
                GROUP BY "deviceId"
                HAVING COUNT(*) FILTER (WHERE "time" < {sinceUtc}) > 0
                   AND COUNT(*) FILTER (WHERE "time" >= {sinceUtc}) > 0
                """)
            : _db.Database.SqlQuery<MetricAggregate>(
                $"""
                WITH "BoundarySamples" AS (
                    SELECT DISTINCT ON ("deviceId") "deviceId", "value", "time"
                    FROM "MonitoringMetric"
                    WHERE "organizationId" = {organizationId}
                      AND "metric" = {metric}
                      AND "time" >= {boundaryFloorUtc}
                      AND "time" < {sinceUtc}
                      AND "deviceId" = ANY ({deviceIds.ToArray()})
                    ORDER BY "deviceId", "time" DESC
                ),
                "WindowSamples" AS (
                    SELECT "deviceId", "value", "time"
                    FROM "MonitoringMetric"
                    WHERE "organizationId" = {organizationId}
                      AND "metric" = {metric}
                      AND "time" >= {sinceUtc}
                      AND "time" <= {nowUtc}
                      AND "deviceId" = ANY ({deviceIds.ToArray()})
                ),
                "Samples" AS (
                    SELECT * FROM "BoundarySamples"
                    UNION ALL
                    SELECT * FROM "WindowSamples"
                )
                SELECT "deviceId" AS "DeviceId",
                       CASE WHEN {op} = 'lt' THEN MAX("value") ELSE MIN("value") END AS "Value"
                FROM "Samples"
                GROUP BY "deviceId"
                HAVING COUNT(*) FILTER (WHERE "time" < {sinceUtc}) > 0
                   AND COUNT(*) FILTER (WHERE "time" >= {sinceUtc}) > 0
                """);

        return await query.ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<AlertDeliveryRecord>> ListDueDeliveriesAsync(
        DateTime nowUtc,
        int take,
        CancellationToken cancellationToken) =>
        [.. (await _db.Deliveries.AsNoTracking()
                .Include(delivery => delivery.Event)
                .Where(delivery =>
                    (delivery.Status == AlertDeliveryStatus.Pending
                     || delivery.Status == AlertDeliveryStatus.Failed)
                    && delivery.NextAttemptAt <= nowUtc)
                .OrderBy(delivery => delivery.NextAttemptAt)
                .ThenBy(delivery => delivery.Id)
                .Take(take)
                .ToListAsync(cancellationToken))
            .Select(ToRecord)];

    public async Task<IReadOnlyList<AlertChannelRecord>> FindChannelsAsync(
        IReadOnlyCollection<string> channelIds,
        CancellationToken cancellationToken)
    {
        if (channelIds.Count == 0)
        {
            return [];
        }

        return [.. (await _db.Channels.AsNoTracking()
                .Where(channel => channelIds.Contains(channel.Id))
                .ToListAsync(cancellationToken))
            .Select(ToRecord)];
    }

    public async Task UpdateDeliveryAsync(
        string deliveryId,
        AlertDeliveryStatus status,
        int attempts,
        DateTime? lastAttemptAt,
        DateTime? nextAttemptAt,
        string? lastError,
        CancellationToken cancellationToken)
    {
        var row = await _db.Deliveries.SingleAsync(
            delivery => delivery.Id == deliveryId,
            cancellationToken);
        row.Status = status;
        row.Attempts = attempts;
        row.LastAttemptAt = lastAttemptAt;
        if (nextAttemptAt is not null)
        {
            row.NextAttemptAt = nextAttemptAt.Value;
        }

        row.LastError = lastError;
        await _db.SaveChangesAsync(cancellationToken);
    }

    public async Task<(int Up, int Down, int Warning, int Unknown)> CountDeviceStatesAsync(
        CancellationToken cancellationToken)
    {
        var rows = await _db.Database.SqlQueryRaw<StateCount>(
                """
                SELECT "state"::text AS "State", COUNT(*)::int AS "Count"
                FROM "DeviceStatus"
                GROUP BY "state"
                """)
            .ToListAsync(cancellationToken);
        var counts = rows.ToDictionary(row => row.State, row => row.Count, StringComparer.Ordinal);
        return (
            counts.GetValueOrDefault("UP"),
            counts.GetValueOrDefault("DOWN"),
            counts.GetValueOrDefault("WARNING"),
            counts.GetValueOrDefault("UNKNOWN"));
    }

    private async Task SaveUniqueAsync(
        string code,
        string message,
        CancellationToken cancellationToken)
    {
        try
        {
            await _db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (
            exception.InnerException is PostgresException
            {
                SqlState: PostgresErrorCodes.UniqueViolation,
            })
        {
            throw new ApiException(code, message, 409);
        }
    }

    private static AlertChannelRecord ToRecord(AlertChannelRow row) => new(
        row.Id,
        row.OrganizationId,
        row.Type,
        row.Name,
        row.Enabled,
        row.ConfigJson,
        row.SecretEnc,
        row.Version,
        row.CreatedAt,
        row.UpdatedAt);

    private static AlertRuleRecord ToRecord(AlertRuleRow row)
    {
        var dto = JsonSerializer.Deserialize<AlertScopeDto>(row.ScopeJson, JsonOptions)
            ?? throw new InvalidOperationException($"Rule {row.Id} has an invalid scope");
        var errors = new List<string>();
        var scope = dto.Validate(errors);
        if (scope is null || errors.Count > 0)
        {
            throw new InvalidOperationException($"Rule {row.Id} has an invalid scope");
        }

        return new AlertRuleRecord(
            row.Id,
            row.OrganizationId,
            row.Name,
            row.Enabled,
            row.Trigger,
            scope,
            row.TargetStates,
            row.Metric,
            row.Op,
            row.Threshold,
            row.ForSeconds,
            row.Severity,
            [.. row.Channels.Select(link => link.ChannelId).Order(StringComparer.Ordinal)],
            row.CooldownSeconds,
            row.NotifyOnRecovery,
            row.Version,
            row.CreatedAt,
            row.UpdatedAt);
    }

    private static AlertEventRecord ToRecord(AlertEventRow row) => new(
        row.Id,
        row.OrganizationId,
        row.RuleId,
        row.RuleName,
        row.DeviceId,
        row.Kind,
        row.Severity,
        row.DetailJson,
        row.DedupKey,
        row.CreatedAt);

    private static AlertDeliveryRecord ToRecord(AlertDeliveryRow row) => new(
        row.Id,
        row.AlertEventId,
        row.ChannelId,
        row.Status,
        row.Attempts,
        row.LastAttemptAt,
        row.NextAttemptAt,
        row.LastError,
        ToRecord(row.Event));

    private sealed record StateCount(string State, int Count);
}
