using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Inventory.Domain;
using NodeScope.Platform.Data;

namespace NodeScope.Modules.Inventory.Infrastructure.Persistence;

/// <summary>
/// Inventory's slice of the existing schema (Decision 5). Rows the module owns are mapped
/// fully; tables it only counts against (<c>BuildingModel</c>, <c>TeamProperty</c>,
/// <c>MemberProperty</c>) are mapped as narrow slices, mirroring how the Node repositories
/// read them through Prisma without owning them.
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

    public DbSet<DeviceSliceRow> Devices => Set<DeviceSliceRow>();

    public DbSet<BuildingModelSliceRow> BuildingModels => Set<BuildingModelSliceRow>();

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

        modelBuilder.Entity<DeviceSliceRow>(entity =>
        {
            entity.ToTable("Device");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<BuildingModelSliceRow>(entity =>
        {
            entity.ToTable("BuildingModel");
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

/// <summary>The placement slice of the <c>Device</c> table containment checks read.</summary>
internal sealed class DeviceSliceRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string NetworkId { get; set; } = null!;

    public string PropertyId { get; set; } = null!;
}

/// <summary>The existence slice of <c>BuildingModel</c> (delete guard <c>MODEL_008</c>).</summary>
internal sealed class BuildingModelSliceRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string PropertyId { get; set; } = null!;
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
