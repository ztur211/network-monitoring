using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Inventory.Domain;
using NodeScope.Platform.Data;

namespace NodeScope.Modules.Inventory.Infrastructure.Persistence;

/// <summary>
/// Inventory's slice of the existing schema (Decision 5). Rows the module owns are mapped
/// fully; tables it only counts against or reads a column from (<c>Organization</c>,
/// <c>TeamProperty</c>, <c>MemberProperty</c>) are mapped as narrow
/// slices, mirroring how the Node repositories read them through Prisma without owning them.
/// <c>Device.location</c> (PostGIS) stays unmapped: a database trigger derives it from
/// lat/lng, so nothing here writes it.
/// </summary>
internal sealed class InventoryDbContext : DbContext
{
    public InventoryDbContext(DbContextOptions<InventoryDbContext> options)
        : base(options)
    {
    }

    public DbSet<PropertyRow> Properties => Set<PropertyRow>();

    public DbSet<NetworkRow> Networks => Set<NetworkRow>();

    public DbSet<NetworkPropertyRow> NetworkProperties => Set<NetworkPropertyRow>();

    public DbSet<DeviceRow> Devices => Set<DeviceRow>();

    public DbSet<OrganizationSliceRow> Organizations => Set<OrganizationSliceRow>();

    public DbSet<CircuitRow> Circuits => Set<CircuitRow>();

    public DbSet<FiberRunRow> FiberRuns => Set<FiberRunRow>();

    public DbSet<DeviceConnectionRow> DeviceConnections => Set<DeviceConnectionRow>();

    public DbSet<BuildingModelRow> BuildingModels => Set<BuildingModelRow>();

    public DbSet<BuildingModelVersionRow> BuildingModelVersions => Set<BuildingModelVersionRow>();

    public DbSet<DeviceMetricRow> DeviceMetrics => Set<DeviceMetricRow>();

    public DbSet<UserSliceRow> Users => Set<UserSliceRow>();

    public DbSet<OrganizationMemberSliceRow> OrganizationMembers => Set<OrganizationMemberSliceRow>();

    public DbSet<BcfTopicRow> BcfTopics => Set<BcfTopicRow>();

    public DbSet<BcfCommentRow> BcfComments => Set<BcfCommentRow>();

    public DbSet<BcfViewpointRow> BcfViewpoints => Set<BcfViewpointRow>();

    public DbSet<BcfTopicDeviceRow> BcfTopicDevices => Set<BcfTopicDeviceRow>();

    public DbSet<TeamPropertySliceRow> TeamProperties => Set<TeamPropertySliceRow>();

    public DbSet<MemberPropertySliceRow> MemberProperties => Set<MemberPropertySliceRow>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<PropertyRow>(entity =>
        {
            entity.ToTable("Property");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<NetworkRow>(entity =>
        {
            entity.ToTable("Network");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<NetworkPropertyRow>(entity =>
        {
            entity.ToTable("NetworkProperty");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<DeviceRow>(entity =>
        {
            entity.ToTable("Device");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<OrganizationSliceRow>(entity =>
        {
            entity.ToTable("Organization");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<CircuitRow>(entity =>
        {
            entity.ToTable("Circuit");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<FiberRunRow>(entity =>
        {
            entity.ToTable("FiberRun");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<DeviceConnectionRow>(entity =>
        {
            entity.ToTable("DeviceConnection");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<BuildingModelRow>(entity =>
        {
            entity.ToTable("BuildingModel");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<BuildingModelVersionRow>(entity =>
        {
            entity.ToTable("BuildingModelVersion");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<DeviceMetricRow>(entity =>
        {
            entity.ToTable("DeviceMetric");
            entity.HasKey(row => new { row.Id, row.Time });
        });

        modelBuilder.Entity<UserSliceRow>(entity =>
        {
            entity.ToTable("User");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<OrganizationMemberSliceRow>(entity =>
        {
            entity.ToTable("OrganizationMember");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<BcfTopicRow>(entity =>
        {
            entity.ToTable("BcfTopic");
            entity.HasKey(row => row.Id);
            entity.HasIndex(row => new { row.OrganizationId, row.Guid }).IsUnique();
        });

        modelBuilder.Entity<BcfCommentRow>(entity =>
        {
            entity.ToTable("BcfComment");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<BcfViewpointRow>(entity =>
        {
            entity.ToTable("BcfViewpoint");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<BcfTopicDeviceRow>(entity =>
        {
            entity.ToTable("BcfTopicDevice");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<TeamPropertySliceRow>(entity =>
        {
            entity.ToTable("TeamProperty");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<MemberPropertySliceRow>(entity =>
        {
            entity.ToTable("MemberProperty");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.ApplyNodeScopeColumnConventions();
    }
}

/// <summary>A <c>Property</c> row. Ids are app-generated uuids; <c>UpdatedAt</c> is app-assigned.</summary>
internal sealed class PropertyRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string? ParentId { get; set; }

    public PropertyType Type { get; set; }

    public string Name { get; set; } = null!;

    public string? Code { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

/// <summary>A <c>Network</c> row (the SNMP assignment FKs stay with Monitoring).</summary>
internal sealed class NetworkRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string? UserId { get; set; }

    public string Name { get; set; } = null!;

    public string? HomeAddress { get; set; }

    public double? HomeLatitude { get; set; }

    public double? HomeLongitude { get; set; }

    public string? HomePublicIp { get; set; }

    public string? Isp { get; set; }

    public double? DownMbps { get; set; }

    public double? UpMbps { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

/// <summary>A <c>NetworkProperty</c> charter row.</summary>
internal sealed class NetworkPropertyRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string NetworkId { get; set; } = null!;

    public string PropertyId { get; set; } = null!;

    public DateTime CreatedAt { get; set; }
}

/// <summary>A <c>Device</c> row (the SNMP assignment FKs stay with Monitoring).</summary>
internal sealed class DeviceRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string? UserId { get; set; }

    public string NetworkId { get; set; } = null!;

    public string PropertyId { get; set; } = null!;

    public string? RoleCode { get; set; }

    public string Name { get; set; } = null!;

    public DeviceCategory Category { get; set; }

    public DeviceMobility Mobility { get; set; }

    public double? Latitude { get; set; }

    public double? Longitude { get; set; }

    public int? Floor { get; set; }

    public string? FloorLabel { get; set; }

    public double? X { get; set; }

    public double? Y { get; set; }

    public double? Z { get; set; }

    public string? IfcGlobalId { get; set; }

    public string? IpAddress { get; set; }

    public string? MacAddress { get; set; }

    public string? Notes { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

/// <summary>The naming-policy slice of <c>Organization</c>, the only columns Inventory reads.</summary>
internal sealed class OrganizationSliceRow
{
    public string Id { get; set; } = null!;

    public string? NamingPattern { get; set; }

    public int? NamingMaxLen { get; set; }

    public string? NamingTemplate { get; set; }
}

/// <summary>A <c>BuildingModel</c> row - one per BUILDING, pointing at its active version.</summary>
internal sealed class BuildingModelRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string PropertyId { get; set; } = null!;

    public string Name { get; set; } = null!;

    public string? ActiveVersionId { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

/// <summary>An immutable <c>BuildingModelVersion</c> row; the blob itself lives at StorageKey.</summary>
internal sealed class BuildingModelVersionRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string BuildingModelId { get; set; } = null!;

    public int VersionNumber { get; set; }

    public string StorageKey { get; set; } = null!;

    public string FileName { get; set; } = null!;

    public string ContentHash { get; set; } = null!;

    public int SizeBytes { get; set; }

    public string? Units { get; set; }

    public string? UploadedByMemberId { get; set; }

    public DateTime CreatedAt { get; set; }
}

/// <summary>
/// The browser-collector reading slice of the <c>DeviceMetric</c> hypertable. Read-only here;
/// ingest belongs to the collector path. The composite key mirrors the hypertable's
/// <c>(id, time)</c> primary key, which Timescale requires to include the partitioning column.
/// </summary>
internal sealed class DeviceMetricRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string UserId { get; set; } = null!;

    public double? BandwidthDown { get; set; }

    public double? BandwidthUp { get; set; }

    public double? Latency { get; set; }

    public string? ConnectionQuality { get; set; }

    public DateTime Time { get; set; }
}

/// <summary>The membership slice of <c>OrganizationMember</c>: which org a user belongs to.</summary>
internal sealed class OrganizationMemberSliceRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string UserId { get; set; } = null!;
}

/// <summary>The onboarding slice of <c>User</c> - the wizard's durable completion marker.</summary>
internal sealed class UserSliceRow
{
    public string Id { get; set; } = null!;

    public DateTime? OnboardingCompletedAt { get; set; }
}

/// <summary>The existence slice of <c>TeamProperty</c> (delete guard <c>PERM_005</c>).</summary>
internal sealed class TeamPropertySliceRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string PropertyId { get; set; } = null!;
}

/// <summary>The existence slice of <c>MemberProperty</c> (delete guard <c>PERM_005</c>).</summary>
internal sealed class MemberPropertySliceRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string PropertyId { get; set; } = null!;
}

/// <summary>A <c>Circuit</c> row.</summary>
internal sealed class CircuitRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string? UserId { get; set; }

    public string IspName { get; set; } = null!;

    public string? CircuitId { get; set; }

    public string ServiceType { get; set; } = null!;

    public double? Bandwidth { get; set; }

    public string? DeviceId { get; set; }

    public string? Notes { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

/// <summary>A <c>FiberRun</c> row.</summary>
internal sealed class FiberRunRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string? UserId { get; set; }

    public string Name { get; set; } = null!;

    public string StartDeviceId { get; set; } = null!;

    public string EndDeviceId { get; set; } = null!;

    public string? CableType { get; set; }

    public double? LengthMeters { get; set; }

    public string? Notes { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

/// <summary>A <c>DeviceConnection</c> row.</summary>
internal sealed class DeviceConnectionRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string? UserId { get; set; }

    public string SourceDeviceId { get; set; } = null!;

    public string TargetDeviceId { get; set; } = null!;

    public ConnectionType ConnectionType { get; set; }

    public string? Notes { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

/// <summary>A <c>BcfTopic</c> row - one BIM coordination issue on a building.</summary>
internal sealed class BcfTopicRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string PropertyId { get; set; } = null!;

    public string Guid { get; set; } = null!;

    public string Title { get; set; } = null!;

    public string? TopicType { get; set; }

    public string? TopicStatus { get; set; }

    public string? Priority { get; set; }

    public string[] Labels { get; set; } = [];

    public string CreationAuthor { get; set; } = null!;

    public DateTime CreationDate { get; set; }

    public string? ModifiedAuthor { get; set; }

    public DateTime? ModifiedDate { get; set; }

    public string? AssignedTo { get; set; }

    public DateTime? DueDate { get; set; }

    public string? Description { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

/// <summary>A <c>BcfComment</c> row.</summary>
internal sealed class BcfCommentRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string TopicId { get; set; } = null!;

    public string Guid { get; set; } = null!;

    public string Comment { get; set; } = null!;

    public string Author { get; set; } = null!;

    public DateTime Date { get; set; }

    public string? ViewpointGuid { get; set; }
}

/// <summary>A <c>BcfViewpoint</c> row; camera/components/clippingPlanes are jsonb.</summary>
internal sealed class BcfViewpointRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string TopicId { get; set; } = null!;

    public string Guid { get; set; } = null!;

    public JsonDocument Camera { get; set; } = null!;

    public JsonDocument Components { get; set; } = null!;

    public JsonDocument ClippingPlanes { get; set; } = null!;

    public string? SnapshotKey { get; set; }

    public bool IsPrimary { get; set; }
}

/// <summary>A <c>BcfTopicDevice</c> link row (topic to the devices its viewpoints select).</summary>
internal sealed class BcfTopicDeviceRow
{
    public string Id { get; set; } = null!;

    public string TopicId { get; set; } = null!;

    public string DeviceId { get; set; } = null!;
}
