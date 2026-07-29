using System.Text.Json;
using System.Text.Json.Serialization;

namespace NodeScope.Desktop.Api;

internal sealed record AlertChannel(
    string Id,
    string OrganizationId,
    string Type,
    string Name,
    bool Enabled,
    JsonElement Config,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt);

internal sealed record CreateAlertChannel(
    string Type,
    string Name,
    bool Enabled,
    JsonElement Config,
    string? Secret);

internal sealed record AlertRule(
    string Id,
    string OrganizationId,
    string Name,
    bool Enabled,
    string Trigger,
    JsonElement Scope,
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

internal sealed record CreateAlertRule(
    string Name,
    string Trigger,
    JsonElement Scope,
    IReadOnlyList<string> TargetStates,
    string? Metric,
    string? Op,
    double? Threshold,
    int? ForSeconds,
    string Severity,
    IReadOnlyList<string> ChannelIds,
    int CooldownSeconds,
    bool NotifyOnRecovery,
    bool Enabled = true);

internal sealed record AlertEvent(
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
