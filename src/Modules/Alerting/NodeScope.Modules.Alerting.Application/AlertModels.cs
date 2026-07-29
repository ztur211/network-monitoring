using System.Text.Json;
using System.Text.Json.Serialization;
using NodeScope.Modules.Alerting.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Alerting.Application;

public sealed record AlertChannelDto(
    string Id,
    string OrganizationId,
    string Type,
    string Name,
    bool Enabled,
    JsonElement Config,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public sealed record AlertRuleDto(
    string Id,
    string OrganizationId,
    string Name,
    bool Enabled,
    string Trigger,
    AlertScopeDto Scope,
    IReadOnlyList<string> TargetStates,
    string? Metric,
    string? Op,
    double? Threshold,
    int? ForSeconds,
    string Severity,
    IReadOnlyList<string> ChannelIds,
    int CooldownSeconds,
    bool NotifyOnRecovery,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public sealed record AlertEventDto(
    string Id,
    string OrganizationId,
    string? RuleId,
    string RuleName,
    string? DeviceId,
    string Kind,
    string Severity,
    JsonElement Detail,
    string DedupKey,
    DateTime CreatedAt);

public sealed record AlertScope(
    bool All,
    IReadOnlyList<string> DeviceIds,
    IReadOnlyList<string> NetworkIds,
    IReadOnlyList<string> PropertyIds)
{
    public AlertScopeSelection ToSelection() =>
        new(All, DeviceIds, NetworkIds, PropertyIds);
}

public sealed class AlertScopeDto
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? All { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<string>? DeviceIds { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<string>? NetworkIds { get; init; }

    [JsonPropertyName("siteIds")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<string>? PropertyIds { get; init; }

    public AlertScope? Validate(ICollection<string> errors)
    {
        ArgumentNullException.ThrowIfNull(errors);
        var selected = (All is not null ? 1 : 0)
            + (DeviceIds is not null ? 1 : 0)
            + (NetworkIds is not null ? 1 : 0)
            + (PropertyIds is not null ? 1 : 0);
        if (selected != 1)
        {
            errors.Add("scope must contain exactly one of all, deviceIds, networkIds, or siteIds");
            return null;
        }

        if (All is not null)
        {
            if (All != true)
            {
                errors.Add("scope.all must be true");
                return null;
            }

            return new AlertScope(true, [], [], []);
        }

        var ids = DeviceIds ?? NetworkIds ?? PropertyIds!;
        if (ids.Count == 0)
        {
            errors.Add("scope id list should not be empty");
            return null;
        }

        if (ids.Count > 500)
        {
            errors.Add("scope id list must contain no more than 500 values");
        }

        if (ids.Any(id => !Guid.TryParse(id, out _)))
        {
            errors.Add("each scope id must be a UUID");
        }

        var normalized = ids
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Distinct(StringComparer.Ordinal)
            .ToList();
        return new AlertScope(
            false,
            DeviceIds is null ? [] : normalized,
            NetworkIds is null ? [] : normalized,
            PropertyIds is null ? [] : normalized);
    }

    public static AlertScopeDto From(AlertScope scope)
    {
        ArgumentNullException.ThrowIfNull(scope);
        return scope.All
            ? new AlertScopeDto { All = true }
            : scope.DeviceIds.Count > 0
                ? new AlertScopeDto { DeviceIds = scope.DeviceIds }
                : scope.NetworkIds.Count > 0
                    ? new AlertScopeDto { NetworkIds = scope.NetworkIds }
                    : new AlertScopeDto { PropertyIds = scope.PropertyIds };
    }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class CreateAlertChannelRequest
{
    public string? Type { get; init; }

    public string? Name { get; init; }

    public bool? Enabled { get; init; }

    public JsonElement? Config { get; init; }

    public string? Secret { get; init; }

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        RequestValidation.RequireNonEmptyString(errors, Name, "name");
        RequestValidation.MaxLength(errors, Name, "name", 100);
        if (AlertLabels.ParseChannelType(Type) is null)
        {
            errors.Add("type must be one of the following values: WEBHOOK, EMAIL, INAPP");
        }

        if (Secret?.Length > 4096)
        {
            errors.Add("secret must be shorter than or equal to 4096 characters");
        }

        ValidateConfig(errors);
        return errors;
    }

    private void ValidateConfig(List<string> errors)
    {
        var config = Config;
        if (config is not null && config.Value.ValueKind != JsonValueKind.Object)
        {
            errors.Add("config must be an object");
            return;
        }

        if (config?.GetRawText().Length > 16_384)
        {
            errors.Add("config must be shorter than or equal to 16384 characters");
            return;
        }

        if (Type == "WEBHOOK")
        {
            RejectUnexpectedProperties(errors, config, "url");
            var url = JsonString(config, "url");
            if (url is null || !Uri.TryCreate(url, UriKind.Absolute, out var parsed)
                || parsed.Scheme is not ("http" or "https")
                || !string.IsNullOrEmpty(parsed.UserInfo)
                || url.Length > 2048)
            {
                errors.Add(
                    "config.url must be an absolute HTTP or HTTPS URL without embedded credentials");
            }
        }
        else if (Type == "EMAIL")
        {
            RejectUnexpectedProperties(
                errors,
                config,
                "host",
                "port",
                "fromAddr",
                "toAddrs",
                "username");
            var host = JsonString(config, "host");
            if (string.IsNullOrWhiteSpace(host) || host.Length > 255)
            {
                errors.Add("config.host must contain 1 to 255 characters");
            }

            if (config is not null
                && config.Value.TryGetProperty("port", out var configuredPort)
                && (configuredPort.ValueKind != JsonValueKind.Number
                    || !configuredPort.TryGetInt32(out var port)
                    || port is < 1 or > 65535))
            {
                errors.Add("config.port must be between 1 and 65535");
            }

            if (!LooksLikeEmail(JsonString(config, "fromAddr")))
            {
                errors.Add("config.fromAddr must be an email address");
            }

            if (config is null
                || !config.Value.TryGetProperty("toAddrs", out var to)
                || to.ValueKind != JsonValueKind.Array
                || to.GetArrayLength() == 0
                || to.EnumerateArray().Any(item =>
                    item.ValueKind != JsonValueKind.String || !LooksLikeEmail(item.GetString())))
            {
                errors.Add("config.toAddrs must be a non-empty array of email addresses");
            }

            if (config is not null
                && config.Value.TryGetProperty("username", out var username)
                && (username.ValueKind is not JsonValueKind.String
                    || username.GetString()?.Length > 255))
            {
                errors.Add("config.username must be a string no longer than 255 characters");
            }
        }
        else if (Type == "INAPP")
        {
            RejectUnexpectedProperties(errors, config);
            if (!string.IsNullOrEmpty(Secret))
            {
                errors.Add("secret is not allowed for an in-app channel");
            }
        }
    }

    internal static string? JsonString(JsonElement? config, string name) =>
        config is not null
        && config.Value.ValueKind == JsonValueKind.Object
        && config.Value.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static bool LooksLikeEmail(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 320)
        {
            return false;
        }

        var at = value.IndexOf('@', StringComparison.Ordinal);
        return at > 0 && at < value.Length - 1;
    }

    private static void RejectUnexpectedProperties(
        List<string> errors,
        JsonElement? config,
        params string[] allowed)
    {
        if (config is null || config.Value.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        var allowedNames = allowed.ToHashSet(StringComparer.Ordinal);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in config.Value.EnumerateObject())
        {
            if (!seen.Add(property.Name))
            {
                errors.Add($"config.{property.Name} must not be duplicated");
            }
            else if (!allowedNames.Contains(property.Name))
            {
                errors.Add($"config.{property.Name} is not allowed for this channel type");
            }
        }
    }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class CreateAlertRuleRequest
{
    public string? Name { get; init; }

    public string? Trigger { get; init; }

    public AlertScopeDto? Scope { get; init; }

    public IReadOnlyList<string>? TargetStates { get; init; }

    public string? Metric { get; init; }

    public string? Op { get; init; }

    public double? Threshold { get; init; }

    public int? ForSeconds { get; init; }

    public string? Severity { get; init; }

    public IReadOnlyList<string>? ChannelIds { get; init; }

    public int? CooldownSeconds { get; init; }

    public bool? NotifyOnRecovery { get; init; }

    public bool? Enabled { get; init; }

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        RequestValidation.RequireNonEmptyString(errors, Name, "name");
        RequestValidation.MaxLength(errors, Name, "name", 100);
        var trigger = AlertLabels.ParseTrigger(Trigger);
        if (trigger is null)
        {
            errors.Add("trigger must be one of the following values: STATE_TRANSITION, METRIC_THRESHOLD");
        }

        if (AlertLabels.ParseSeverity(Severity) is null)
        {
            errors.Add("severity must be one of the following values: INFO, WARNING, CRITICAL");
        }

        if (Scope is null)
        {
            errors.Add("scope must be an object");
        }
        else
        {
            _ = Scope.Validate(errors);
        }

        if (ChannelIds is null || ChannelIds.Count == 0)
        {
            errors.Add("channelIds should not be empty");
        }
        else if (ChannelIds.Any(id => !Guid.TryParse(id, out _)))
        {
            errors.Add("each value in channelIds must be a UUID");
        }

        if (CooldownSeconds is null or < 0 or > 2_592_000)
        {
            errors.Add("cooldownSeconds must be between 0 and 2592000");
        }

        if (NotifyOnRecovery is null)
        {
            errors.Add("notifyOnRecovery must be a boolean");
        }

        if (trigger == AlertTrigger.StateTransition)
        {
            if (TargetStates is null || TargetStates.Count == 0
                || TargetStates.Any(state => state is not ("DOWN" or "WARNING")))
            {
                errors.Add("targetStates must contain DOWN or WARNING");
            }

            if (Metric is not null || Op is not null || Threshold is not null || ForSeconds is not null)
            {
                errors.Add("metric fields are not allowed for a state transition rule");
            }
        }
        else if (trigger == AlertTrigger.MetricThreshold)
        {
            if (Metric != "latencyMs")
            {
                errors.Add("metric must be latencyMs");
            }

            if (Op is not ("gt" or "lt"))
            {
                errors.Add("op must be one of the following values: gt, lt");
            }

            if (Threshold is null
                || !double.IsFinite(Threshold.Value)
                || Threshold is < 0 or > 600_000)
            {
                errors.Add("threshold must be a finite number between 0 and 600000");
            }

            if (ForSeconds is null or < 1 or > 86_400)
            {
                errors.Add("forSeconds must be between 1 and 86400");
            }

            if (TargetStates is { Count: > 0 })
            {
                errors.Add("targetStates is not allowed for a metric threshold rule");
            }
        }

        return errors;
    }
}

public sealed record AlertChannelRecord(
    string Id,
    string OrganizationId,
    AlertChannelType Type,
    string Name,
    bool Enabled,
    string ConfigJson,
    string? SecretEnc,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public sealed record AlertRuleRecord(
    string Id,
    string OrganizationId,
    string Name,
    bool Enabled,
    AlertTrigger Trigger,
    AlertScope Scope,
    IReadOnlyList<string> TargetStates,
    string? Metric,
    string? Op,
    double? Threshold,
    int? ForSeconds,
    AlertSeverity Severity,
    IReadOnlyList<string> ChannelIds,
    int CooldownSeconds,
    bool NotifyOnRecovery,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public sealed record AlertEventRecord(
    string Id,
    string OrganizationId,
    string? RuleId,
    string RuleName,
    string? DeviceId,
    AlertEventKind Kind,
    AlertSeverity Severity,
    string DetailJson,
    string DedupKey,
    DateTime CreatedAt);

public sealed record AlertDeliveryRecord(
    string Id,
    string AlertEventId,
    string? ChannelId,
    AlertDeliveryStatus Status,
    int Attempts,
    DateTime? LastAttemptAt,
    DateTime NextAttemptAt,
    string? LastError,
    AlertEventRecord Event);

public sealed record MetricAggregate(string DeviceId, double Value);

public sealed record NewAlertChannel(
    string OrganizationId,
    AlertChannelType Type,
    string Name,
    bool Enabled,
    string ConfigJson,
    string? SecretEnc);

public sealed record NewAlertRule(
    string OrganizationId,
    string Name,
    bool Enabled,
    AlertTrigger Trigger,
    AlertScope Scope,
    IReadOnlyList<string> TargetStates,
    string? Metric,
    string? Op,
    double? Threshold,
    int? ForSeconds,
    AlertSeverity Severity,
    IReadOnlyList<string> ChannelIds,
    int CooldownSeconds,
    bool NotifyOnRecovery);
