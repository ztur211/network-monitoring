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

    public DbSet<SnmpCredentialRow> SnmpCredentials => Set<SnmpCredentialRow>();

    public DbSet<OidProfileRow> OidProfiles => Set<OidProfileRow>();

    public DbSet<OidEntryRow> OidEntries => Set<OidEntryRow>();

    public DbSet<NetworkSliceRow> Networks => Set<NetworkSliceRow>();

    public DbSet<NetworkPropertyRow> NetworkProperties => Set<NetworkPropertyRow>();

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

        modelBuilder.Entity<SnmpCredentialRow>(entity =>
        {
            entity.ToTable("SnmpCredential");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<OidProfileRow>(entity =>
        {
            entity.ToTable("OidProfile");
            entity.HasKey(row => row.Id);
            entity.HasMany(row => row.Entries).WithOne().HasForeignKey(e => e.OidProfileId);
        });

        modelBuilder.Entity<OidEntryRow>(entity =>
        {
            entity.ToTable("OidEntry");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<NetworkSliceRow>(entity =>
        {
            entity.ToTable("Network");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<NetworkPropertyRow>(entity =>
        {
            entity.ToTable("NetworkProperty");
            entity.HasKey(row => row.Id);
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

    public string NetworkId { get; set; } = null!;

    public string? SnmpCredentialId { get; set; }

    public string? OidProfileId { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

/// <summary>An <c>SnmpCredential</c> row (secrets encrypted at rest).</summary>
internal sealed class SnmpCredentialRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string Name { get; set; } = null!;

    public SnmpVersion SnmpVersion { get; set; }

    public SnmpSecurityLevel? SecurityLevel { get; set; }

    public string? SecurityName { get; set; }

    public SnmpAuthProtocol? AuthProtocol { get; set; }

    public SnmpPrivProtocol? PrivProtocol { get; set; }

    public string? CommunityEnc { get; set; }

    public string? AuthKeyEnc { get; set; }

    public string? PrivKeyEnc { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

/// <summary>An <c>OidProfile</c> row with its entries.</summary>
internal sealed class OidProfileRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string Name { get; set; } = null!;

    public bool IncludeInterfaceMetrics { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public List<OidEntryRow> Entries { get; } = [];
}

/// <summary>An <c>OidEntry</c> row.</summary>
internal sealed class OidEntryRow
{
    public string Id { get; set; } = null!;

    public string OidProfileId { get; set; } = null!;

    public string Oid { get; set; } = null!;

    public string Metric { get; set; } = null!;
}

/// <summary>The narrow slice of Inventory's <c>Network</c> table monitoring touches.</summary>
internal sealed class NetworkSliceRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string? SnmpCredentialId { get; set; }

    public string? OidProfileId { get; set; }

    public DateTime UpdatedAt { get; set; }
}

/// <summary>A <c>NetworkProperty</c> charter row (network -&gt; chartered site).</summary>
internal sealed class NetworkPropertyRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string NetworkId { get; set; } = null!;

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
