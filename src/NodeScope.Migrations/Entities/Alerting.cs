using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class AlertChannel
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public AlertChannelType Type { get; set; }

    public string Name { get; set; } = null!;

    public bool Enabled { get; set; }

    public string Config { get; set; } = null!;

    public string? SecretEnc { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual ICollection<AlertRuleChannel> AlertRuleChannel { get; set; } = new List<AlertRuleChannel>();

    public virtual ICollection<AlertDelivery> AlertDelivery { get; set; } = new List<AlertDelivery>();
}

public partial class AlertRule
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string Name { get; set; } = null!;

    public bool Enabled { get; set; }

    public AlertTrigger Trigger { get; set; }

    public string Scope { get; set; } = null!;

#pragma warning disable CA1819 // Npgsql's text[] mapping requires an array property.
    public string[] TargetStates { get; set; } = [];
#pragma warning restore CA1819

    public string? Metric { get; set; }

    public string? Op { get; set; }

    public double? Threshold { get; set; }

    public int? ForSeconds { get; set; }

    public AlertSeverity Severity { get; set; }

    public int CooldownSeconds { get; set; }

    public bool NotifyOnRecovery { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual ICollection<AlertRuleChannel> AlertRuleChannel { get; set; } = new List<AlertRuleChannel>();

    public virtual ICollection<AlertEvent> AlertEvent { get; set; } = new List<AlertEvent>();

    public virtual ICollection<AlertIncident> AlertIncident { get; set; } = new List<AlertIncident>();
}

public partial class AlertRuleChannel
{
    public string RuleId { get; set; } = null!;

    public string ChannelId { get; set; } = null!;

    public virtual AlertRule Rule { get; set; } = null!;

    public virtual AlertChannel Channel { get; set; } = null!;
}

public partial class AlertEvent
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string? RuleId { get; set; }

    public string RuleName { get; set; } = null!;

    public string? DeviceId { get; set; }

    public AlertEventKind Kind { get; set; }

    public AlertSeverity Severity { get; set; }

    public string Detail { get; set; } = null!;

    public string DedupKey { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public virtual AlertRule? Rule { get; set; }

    public virtual ICollection<AlertDelivery> AlertDelivery { get; set; } = new List<AlertDelivery>();
}

public partial class AlertIncident
{
    public string DedupKey { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string RuleId { get; set; } = null!;

    public string DeviceId { get; set; } = null!;

    public bool IsOpen { get; set; }

    public DateTime? LastFiredAt { get; set; }

    public DateTime? LastResolvedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual AlertRule Rule { get; set; } = null!;
}

public partial class AlertDelivery
{
    public string Id { get; set; } = null!;

    public string AlertEventId { get; set; } = null!;

    public string? ChannelId { get; set; }

    public AlertDeliveryStatus Status { get; set; }

    public int Attempts { get; set; }

    public DateTime? LastAttemptAt { get; set; }

    public DateTime NextAttemptAt { get; set; }

    public string? LastError { get; set; }

    public DateTime CreatedAt { get; set; }

    public virtual AlertEvent AlertEvent { get; set; } = null!;

    public virtual AlertChannel? Channel { get; set; }
}
