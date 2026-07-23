using Microsoft.EntityFrameworkCore;
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

/// <summary>The authentication-relevant slice of <c>User</c>.</summary>
internal sealed class UserRow
{
    public string Id { get; set; } = null!;

    public string Email { get; set; } = null!;

    public bool IsSuperAdmin { get; set; }
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
