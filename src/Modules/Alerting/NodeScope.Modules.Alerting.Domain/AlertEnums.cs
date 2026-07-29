namespace NodeScope.Modules.Alerting.Domain;

public enum AlertChannelType
{
    Webhook,
    Email,
    Inapp,
}

public enum AlertTrigger
{
    StateTransition,
    MetricThreshold,
}

public enum AlertSeverity
{
    Info,
    Warning,
    Critical,
}

public enum AlertEventKind
{
    Firing,
    Resolved,
}

public enum AlertDeliveryStatus
{
    Pending,
    Failed,
    Sent,
    GaveUp,
}

public static class AlertLabels
{
    public static string Of(AlertChannelType value) => value switch
    {
        AlertChannelType.Webhook => "WEBHOOK",
        AlertChannelType.Email => "EMAIL",
        AlertChannelType.Inapp => "INAPP",
        _ => throw new ArgumentOutOfRangeException(nameof(value), value, null),
    };

    public static string Of(AlertTrigger value) => value switch
    {
        AlertTrigger.StateTransition => "STATE_TRANSITION",
        AlertTrigger.MetricThreshold => "METRIC_THRESHOLD",
        _ => throw new ArgumentOutOfRangeException(nameof(value), value, null),
    };

    public static string Of(AlertSeverity value) => value switch
    {
        AlertSeverity.Info => "INFO",
        AlertSeverity.Warning => "WARNING",
        AlertSeverity.Critical => "CRITICAL",
        _ => throw new ArgumentOutOfRangeException(nameof(value), value, null),
    };

    public static string Of(AlertEventKind value) => value switch
    {
        AlertEventKind.Firing => "FIRING",
        AlertEventKind.Resolved => "RESOLVED",
        _ => throw new ArgumentOutOfRangeException(nameof(value), value, null),
    };

    public static AlertChannelType? ParseChannelType(string? value) => value switch
    {
        "WEBHOOK" => AlertChannelType.Webhook,
        "EMAIL" => AlertChannelType.Email,
        "INAPP" => AlertChannelType.Inapp,
        _ => null,
    };

    public static AlertTrigger? ParseTrigger(string? value) => value switch
    {
        "STATE_TRANSITION" => AlertTrigger.StateTransition,
        "METRIC_THRESHOLD" => AlertTrigger.MetricThreshold,
        _ => null,
    };

    public static AlertSeverity? ParseSeverity(string? value) => value switch
    {
        "INFO" => AlertSeverity.Info,
        "WARNING" => AlertSeverity.Warning,
        "CRITICAL" => AlertSeverity.Critical,
        _ => null,
    };
}
