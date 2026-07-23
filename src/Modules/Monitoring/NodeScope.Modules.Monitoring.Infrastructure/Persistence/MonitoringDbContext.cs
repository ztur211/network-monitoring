using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Monitoring.Domain;
using NodeScope.Platform.Data;

namespace NodeScope.Modules.Monitoring.Infrastructure.Persistence;

/// <summary>
/// Monitoring's slice of the existing schema (Decision 5). <c>Device</c> is mapped narrowly
/// - only the columns this module reads (and, at the SNMP port, the two assignment FK
/// columns it owns even though they live on Inventory's table), mirroring how the Node
/// monitoring code read <c>prisma.device</c> directly. The keyless hypertables
/// (<c>MonitoringMetric</c>, <c>DeviceStatusEvent</c>) stay raw SQL, unmapped, exactly as
/// they were <c>@@ignore</c>'d for Prisma.
/// </summary>
internal sealed class MonitoringDbContext : DbContext
{
    public MonitoringDbContext(DbContextOptions<MonitoringDbContext> options)
        : base(options)
    {
    }

    public DbSet<AgentRow> Agents => Set<AgentRow>();

    public DbSet<AgentEnrollmentCodeRow> AgentEnrollmentCodes => Set<AgentEnrollmentCodeRow>();

    public DbSet<DeviceSliceRow> Devices => Set<DeviceSliceRow>();

    public DbSet<DeviceStatusRow> DeviceStatuses => Set<DeviceStatusRow>();

    public DbSet<MonitoringIngestTokenRow> IngestTokens => Set<MonitoringIngestTokenRow>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AgentRow>(entity =>
        {
            entity.ToTable("Agent");
            entity.HasKey(row => row.Id);
            entity.HasIndex(row => row.TokenHash).IsUnique();
        });

        modelBuilder.Entity<AgentEnrollmentCodeRow>(entity =>
        {
            entity.ToTable("AgentEnrollmentCode");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<DeviceSliceRow>(entity =>
        {
            entity.ToTable("Device");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<DeviceStatusRow>(entity =>
        {
            entity.ToTable("DeviceStatus");
            entity.HasKey(row => row.Id);
            entity.HasIndex(row => row.DeviceId).IsUnique();
        });

        modelBuilder.Entity<MonitoringIngestTokenRow>(entity =>
        {
            entity.ToTable("MonitoringIngestToken");
            entity.HasKey(row => row.Id);
            entity.HasIndex(row => row.OrganizationId).IsUnique();
        });

        modelBuilder.ApplyNodeScopeColumnConventions();
    }
}

/// <summary>An <c>Agent</c> row. Ids are client-generated uuids; <c>UpdatedAt</c> is app-assigned.</summary>
internal sealed class AgentRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string Name { get; set; } = null!;

    public string? Platform { get; set; }

    public string? Version { get; set; }

    public AgentStatus Status { get; set; }

    public DateTime? LastSeenAt { get; set; }

    public string TokenHash { get; set; } = null!;

    public string? CreatedByMemberId { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

/// <summary>An <c>AgentEnrollmentCode</c> row (single-use, 15-minute TTL, hash only).</summary>
internal sealed class AgentEnrollmentCodeRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string CodeHash { get; set; } = null!;

    public DateTime ExpiresAt { get; set; }

    public string? CreatedByMemberId { get; set; }

    public DateTime? UsedAt { get; set; }

    public DateTime CreatedAt { get; set; }
}

/// <summary>The narrow slice of Inventory's <c>Device</c> table monitoring reads.</summary>
internal sealed class DeviceSliceRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string Name { get; set; } = null!;

    public string? IpAddress { get; set; }

    public string PropertyId { get; set; } = null!;
}

/// <summary>A <c>DeviceStatus</c> row (one per device; the current-state table).</summary>
internal sealed class DeviceStatusRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string DeviceId { get; set; } = null!;

    public DeviceStatusState State { get; set; }

    public double? LatencyMs { get; set; }

    public int ConsecutiveFails { get; set; }

    public DateTime? LastCheckAt { get; set; }

    public DateTime? LastOkAt { get; set; }

    public DateTime? LastChangeAt { get; set; }

    public string? Source { get; set; }

    public DateTime UpdatedAt { get; set; }
}

/// <summary>The one-per-org <c>MonitoringIngestToken</c> row (hash only).</summary>
internal sealed class MonitoringIngestTokenRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string TokenHash { get; set; } = null!;

    public DateTime UpdatedAt { get; set; }
}
