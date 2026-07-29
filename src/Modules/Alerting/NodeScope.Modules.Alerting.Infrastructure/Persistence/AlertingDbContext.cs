using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Alerting.Domain;
using NodeScope.Platform.Data;

namespace NodeScope.Modules.Alerting.Infrastructure.Persistence;

internal sealed class AlertingDbContext : DbContext
{
    public AlertingDbContext(DbContextOptions<AlertingDbContext> options)
        : base(options)
    {
    }

    public DbSet<AlertChannelRow> Channels => Set<AlertChannelRow>();

    public DbSet<AlertRuleRow> Rules => Set<AlertRuleRow>();

    public DbSet<AlertRuleChannelRow> RuleChannels => Set<AlertRuleChannelRow>();

    public DbSet<AlertEventRow> Events => Set<AlertEventRow>();

    public DbSet<AlertIncidentRow> Incidents => Set<AlertIncidentRow>();

    public DbSet<AlertDeliveryRow> Deliveries => Set<AlertDeliveryRow>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AlertChannelRow>(entity =>
        {
            entity.ToTable("AlertChannel");
            entity.HasKey(row => row.Id);
            entity.HasIndex(row => row.OrganizationId);
            entity.HasIndex(row => new { row.OrganizationId, row.Name }).IsUnique();
            entity.Property(row => row.ConfigJson).HasColumnName("config").HasColumnType("jsonb");
        });

        modelBuilder.Entity<AlertRuleRow>(entity =>
        {
            entity.ToTable("AlertRule");
            entity.HasKey(row => row.Id);
            entity.HasIndex(row => row.OrganizationId);
            entity.HasIndex(row => new { row.OrganizationId, row.Name }).IsUnique();
            entity.HasIndex(row => new { row.Enabled, row.Trigger });
            entity.Property(row => row.ScopeJson).HasColumnName("scope").HasColumnType("jsonb");
        });

        modelBuilder.Entity<AlertRuleChannelRow>(entity =>
        {
            entity.ToTable("AlertRuleChannel");
            entity.HasKey(row => new { row.RuleId, row.ChannelId });
            entity.HasOne(row => row.Rule)
                .WithMany(rule => rule.Channels)
                .HasForeignKey(row => row.RuleId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(row => row.Channel)
                .WithMany()
                .HasForeignKey(row => row.ChannelId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<AlertEventRow>(entity =>
        {
            entity.ToTable("AlertEvent");
            entity.HasKey(row => row.Id);
            entity.HasIndex(row => new { row.OrganizationId, row.CreatedAt });
            entity.HasIndex(row => row.DedupKey);
            entity.Property(row => row.DetailJson).HasColumnName("detail").HasColumnType("jsonb");
            entity.HasOne(row => row.Rule)
                .WithMany()
                .HasForeignKey(row => row.RuleId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<AlertIncidentRow>(entity =>
        {
            entity.ToTable("AlertIncident");
            entity.HasKey(row => row.DedupKey);
            entity.HasIndex(row => row.OrganizationId);
            entity.HasOne(row => row.Rule)
                .WithMany()
                .HasForeignKey(row => row.RuleId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<AlertDeliveryRow>(entity =>
        {
            entity.ToTable("AlertDelivery");
            entity.HasKey(row => row.Id);
            entity.HasIndex(row => new { row.Status, row.NextAttemptAt });
            entity.HasIndex(row => new { row.AlertEventId, row.ChannelId }).IsUnique();
            entity.HasOne(row => row.Event)
                .WithMany()
                .HasForeignKey(row => row.AlertEventId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(row => row.Channel)
                .WithMany()
                .HasForeignKey(row => row.ChannelId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.ApplyNodeScopeColumnConventions();
    }
}

internal sealed class AlertChannelRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public AlertChannelType Type { get; set; }

    public string Name { get; set; } = null!;

    public bool Enabled { get; set; }

    public string ConfigJson { get; set; } = null!;

    public string? SecretEnc { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

internal sealed class AlertRuleRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string Name { get; set; } = null!;

    public bool Enabled { get; set; }

    public AlertTrigger Trigger { get; set; }

    public string ScopeJson { get; set; } = null!;

    public string[] TargetStates { get; set; } = [];

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

    public List<AlertRuleChannelRow> Channels { get; } = [];
}

internal sealed class AlertRuleChannelRow
{
    public string RuleId { get; set; } = null!;

    public string ChannelId { get; set; } = null!;

    public AlertRuleRow Rule { get; set; } = null!;

    public AlertChannelRow Channel { get; set; } = null!;
}

internal sealed class AlertEventRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string? RuleId { get; set; }

    public string RuleName { get; set; } = null!;

    public string? DeviceId { get; set; }

    public AlertEventKind Kind { get; set; }

    public AlertSeverity Severity { get; set; }

    public string DetailJson { get; set; } = null!;

    public string DedupKey { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public AlertRuleRow? Rule { get; set; }
}

internal sealed class AlertIncidentRow
{
    public string DedupKey { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string RuleId { get; set; } = null!;

    public string DeviceId { get; set; } = null!;

    public bool IsOpen { get; set; }

    public DateTime? LastFiredAt { get; set; }

    public DateTime? LastResolvedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public AlertRuleRow Rule { get; set; } = null!;
}

internal sealed class AlertDeliveryRow
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

    public AlertEventRow Event { get; set; } = null!;

    public AlertChannelRow? Channel { get; set; }
}
