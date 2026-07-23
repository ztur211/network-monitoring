using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Identity.Domain;
using NodeScope.Platform.Data;

namespace NodeScope.Modules.Identity.Infrastructure.Persistence;

/// <summary>
/// Identity's slice of the existing schema (Decision 5: per-module contexts over the
/// Prisma-created tables; the database does not move). Only the columns the current
/// authentication/scope paths read are mapped; the full Identity surface arrives with the
/// module's endpoint port. <c>Property</c> is deliberately unmapped - the scope walks reach
/// it through the recursive CTEs, same as the Node code.
/// </summary>
internal sealed class IdentityDbContext : DbContext
{
    public IdentityDbContext(DbContextOptions<IdentityDbContext> options)
        : base(options)
    {
    }

    public DbSet<SessionRow> Sessions => Set<SessionRow>();

    public DbSet<UserRow> Users => Set<UserRow>();

    public DbSet<OrganizationRow> Organizations => Set<OrganizationRow>();

    public DbSet<OrganizationMemberRow> OrganizationMembers => Set<OrganizationMemberRow>();

    public DbSet<DeviceMetricRow> DeviceMetrics => Set<DeviceMetricRow>();

    public DbSet<TeamMemberRow> TeamMembers => Set<TeamMemberRow>();

    public DbSet<TeamPropertyRow> TeamProperties => Set<TeamPropertyRow>();

    public DbSet<MemberPropertyRow> MemberProperties => Set<MemberPropertyRow>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<SessionRow>(entity =>
        {
            entity.ToTable("Session");
            entity.HasKey(row => row.Id);
            entity.HasIndex(row => row.Token).IsUnique();
        });

        modelBuilder.Entity<UserRow>(entity =>
        {
            entity.ToTable("User");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<OrganizationRow>(entity =>
        {
            entity.ToTable("Organization");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<OrganizationMemberRow>(entity =>
        {
            entity.ToTable("OrganizationMember");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<DeviceMetricRow>(entity =>
        {
            entity.ToTable("DeviceMetric");
            entity.HasKey(row => new { row.Id, row.Time });
        });

        modelBuilder.Entity<TeamMemberRow>(entity =>
        {
            entity.ToTable("TeamMember");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<TeamPropertyRow>(entity =>
        {
            entity.ToTable("TeamProperty");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.Entity<MemberPropertyRow>(entity =>
        {
            entity.ToTable("MemberProperty");
            entity.HasKey(row => row.Id);
        });

        modelBuilder.ApplyNodeScopeColumnConventions();
    }
}

/// <summary>A row of <c>Session</c> (Better Auth's table; the C# handler reads it verbatim).</summary>
internal sealed class SessionRow
{
    public string Id { get; set; } = null!;

    public string UserId { get; set; } = null!;

    public string Token { get; set; } = null!;

    public DateTime ExpiresAt { get; set; }
}

/// <summary>A <c>User</c> row: the authentication slice plus the profile the module serves.</summary>
internal sealed class UserRow
{
    public string Id { get; set; } = null!;

    public string Email { get; set; } = null!;

    public bool IsSuperAdmin { get; set; }

    public string? Name { get; set; }

    public AccountTier Tier { get; set; }

    public double? HomeLatitude { get; set; }

    public double? HomeLongitude { get; set; }

    public JsonDocument? MapPreferences { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

/// <summary>An <c>Organization</c> row, naming policy included.</summary>
internal sealed class OrganizationRow
{
    public string Id { get; set; } = null!;

    public string Name { get; set; } = null!;

    public string? NamingPattern { get; set; }

    public int? NamingMaxLen { get; set; }

    public string? NamingTemplate { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

/// <summary>An <c>OrganizationMember</c> row.</summary>
internal sealed class OrganizationMemberRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string UserId { get; set; } = null!;

    public OrgRole Role { get; set; }

    public DateTime CreatedAt { get; set; }
}

/// <summary>The reporting slice of the <c>DeviceMetric</c> hypertable (data-source liveness).</summary>
internal sealed class DeviceMetricRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string UserId { get; set; } = null!;

    public DateTime Time { get; set; }
}

/// <summary>A row of <c>TeamMember</c> (member's team memberships, for effective roots).</summary>
internal sealed class TeamMemberRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string TeamId { get; set; } = null!;

    public string MemberId { get; set; } = null!;
}

/// <summary>A row of <c>TeamProperty</c> (team site assignments).</summary>
internal sealed class TeamPropertyRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string TeamId { get; set; } = null!;

    public string PropertyId { get; set; } = null!;
}

/// <summary>A row of <c>MemberProperty</c> (direct member site assignments).</summary>
internal sealed class MemberPropertyRow
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string MemberId { get; set; } = null!;

    public string PropertyId { get; set; } = null!;
}
