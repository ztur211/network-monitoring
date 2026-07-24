using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore;
using NodeScope.Migrations.Entities;

namespace NodeScope.Migrations;

public partial class MigrationsDbContext : DbContext
{
    public MigrationsDbContext(DbContextOptions<MigrationsDbContext> options)
        : base(options)
    {
    }

    public virtual DbSet<Account> Account { get; set; }

    public virtual DbSet<Agent> Agent { get; set; }

    public virtual DbSet<AgentEnrollmentCode> AgentEnrollmentCode { get; set; }

    public virtual DbSet<BcfComment> BcfComment { get; set; }

    public virtual DbSet<BcfTopic> BcfTopic { get; set; }

    public virtual DbSet<BcfTopicDevice> BcfTopicDevice { get; set; }

    public virtual DbSet<BcfViewpoint> BcfViewpoint { get; set; }

    public virtual DbSet<BuildingModel> BuildingModel { get; set; }

    public virtual DbSet<BuildingModelVersion> BuildingModelVersion { get; set; }

    public virtual DbSet<ChangeLog> ChangeLog { get; set; }

    public virtual DbSet<Circuit> Circuit { get; set; }


    public virtual DbSet<Device> Device { get; set; }

    public virtual DbSet<DeviceConnection> DeviceConnection { get; set; }

    public virtual DbSet<DeviceMetric> DeviceMetric { get; set; }

    public virtual DbSet<DeviceStatus> DeviceStatus { get; set; }

    public virtual DbSet<DeviceStatusEvent> DeviceStatusEvent { get; set; }

    public virtual DbSet<FiberRun> FiberRun { get; set; }

    public virtual DbSet<Invitation> Invitation { get; set; }

    public virtual DbSet<JoinRequest> JoinRequest { get; set; }

    public virtual DbSet<MemberProperty> MemberProperty { get; set; }

    public virtual DbSet<MonitoringIngestToken> MonitoringIngestToken { get; set; }

    public virtual DbSet<MonitoringMetric> MonitoringMetric { get; set; }

    public virtual DbSet<Network> Network { get; set; }

    public virtual DbSet<NetworkProperty> NetworkProperty { get; set; }

    public virtual DbSet<OidEntry> OidEntry { get; set; }

    public virtual DbSet<OidProfile> OidProfile { get; set; }

    public virtual DbSet<Organization> Organization { get; set; }

    public virtual DbSet<OrganizationDomain> OrganizationDomain { get; set; }

    public virtual DbSet<OrganizationMember> OrganizationMember { get; set; }


    public virtual DbSet<Property> Property { get; set; }

    public virtual DbSet<Session> Session { get; set; }

    public virtual DbSet<SnmpCredential> SnmpCredential { get; set; }

    public virtual DbSet<Team> Team { get; set; }

    public virtual DbSet<TeamMember> TeamMember { get; set; }

    public virtual DbSet<TeamProperty> TeamProperty { get; set; }

    public virtual DbSet<User> User { get; set; }

    public virtual DbSet<Verification> Verification { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder
            .HasPostgresEnum("AccountTier", new[] { "PERSONAL_FREE", "PERSONAL_PAID", "MULTI_PROPERTY", "ENTERPRISE" })
            .HasPostgresEnum("AgentStatus", new[] { "PENDING", "APPROVED", "REVOKED" })
            .HasPostgresEnum("ChangeAction", new[] { "CREATE", "UPDATE", "DELETE" })
            .HasPostgresEnum("ConnectionType", new[] { "ETHERNET", "FIBER", "WIFI", "LOGICAL" })
            .HasPostgresEnum("DeviceCategory", new[] { "RAD", "ONT", "DSLAM", "ROUTER", "MODEM", "FIBER_MEDIA_CONVERTER", "FIREWALL", "SWITCH", "ACCESS_POINT", "WIFI_EXTENDER", "WIRELESS_BRIDGE", "SERVER_RACK", "PATCH_PANEL", "UPS", "COMPUTER", "PHONE", "TABLET", "PRINTER", "IOT_DEVICE", "CUSTOM" })
            .HasPostgresEnum("DeviceMobility", new[] { "HOME_ONLY", "ROAMS", "UNKNOWN" })
            .HasPostgresEnum("DeviceStatusState", new[] { "UP", "DOWN", "WARNING", "UNKNOWN" })
            .HasPostgresEnum("JoinRequestStatus", new[] { "PENDING", "APPROVED", "DENIED" })
            .HasPostgresEnum("OrgRole", new[] { "OWNER", "ADMIN", "MEMBER" })
            .HasPostgresEnum("PropertyType", new[] { "SITE", "BUILDING", "FLOOR", "AREA" })
            .HasPostgresEnum("SnmpAuthProtocol", new[] { "MD5", "SHA", "SHA256" })
            .HasPostgresEnum("SnmpPrivProtocol", new[] { "DES", "AES", "AES256" })
            .HasPostgresEnum("SnmpSecurityLevel", new[] { "NO_AUTH_NO_PRIV", "AUTH_NO_PRIV", "AUTH_PRIV" })
            .HasPostgresEnum("SnmpVersion", new[] { "V2C", "V3" })
            .HasPostgresExtension("postgis")
            .HasPostgresExtension("timescaledb")
            .HasPostgresExtension("timescaledb_toolkit");

        modelBuilder.Entity<Account>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("Account_pkey");

            entity.HasIndex(e => e.UserId, "Account_userId_idx");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.AccessToken).HasColumnName("accessToken");
            entity.Property(e => e.AccessTokenExpiresAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("accessTokenExpiresAt");
            entity.Property(e => e.AccountId).HasColumnName("accountId");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.IdToken).HasColumnName("idToken");
            entity.Property(e => e.Password).HasColumnName("password");
            entity.Property(e => e.ProviderId).HasColumnName("providerId");
            entity.Property(e => e.RefreshToken).HasColumnName("refreshToken");
            entity.Property(e => e.RefreshTokenExpiresAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("refreshTokenExpiresAt");
            entity.Property(e => e.Scope).HasColumnName("scope");
            entity.Property(e => e.UpdatedAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("updatedAt");
            entity.Property(e => e.UserId).HasColumnName("userId");

            entity.HasOne(d => d.User).WithMany(p => p.Account)
                .HasForeignKey(d => d.UserId)
                .HasConstraintName("Account_userId_fkey");
        });

        modelBuilder.Entity<Agent>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("Agent_pkey");

            entity.HasIndex(e => e.OrganizationId, "Agent_organizationId_idx");

            entity.HasIndex(e => e.TokenHash, "Agent_tokenHash_key").IsUnique();

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.CreatedByMemberId).HasColumnName("createdByMemberId");
            entity.Property(e => e.LastSeenAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("lastSeenAt");
            entity.Property(e => e.Name).HasColumnName("name");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.Platform).HasColumnName("platform");
            entity.Property(e => e.Status)
                .HasDefaultValueSql("'APPROVED'::\"AgentStatus\"")
                .HasColumnName("status");
            entity.Property(e => e.TokenHash).HasColumnName("tokenHash");
            entity.Property(e => e.UpdatedAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("updatedAt");
            entity.Property(e => e.Version).HasColumnName("version");

            entity.HasOne(d => d.Organization).WithMany(p => p.Agent)
                .HasForeignKey(d => d.OrganizationId)
                .HasConstraintName("Agent_organizationId_fkey");
        });

        modelBuilder.Entity<AgentEnrollmentCode>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("AgentEnrollmentCode_pkey");

            entity.HasIndex(e => e.CodeHash, "AgentEnrollmentCode_codeHash_key").IsUnique();

            entity.HasIndex(e => e.OrganizationId, "AgentEnrollmentCode_organizationId_idx");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.CodeHash).HasColumnName("codeHash");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.CreatedByMemberId).HasColumnName("createdByMemberId");
            entity.Property(e => e.ExpiresAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("expiresAt");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.UsedAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("usedAt");

            entity.HasOne(d => d.Organization).WithMany(p => p.AgentEnrollmentCode)
                .HasForeignKey(d => d.OrganizationId)
                .HasConstraintName("AgentEnrollmentCode_organizationId_fkey");
        });

        modelBuilder.Entity<BcfComment>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("BcfComment_pkey");

            entity.HasIndex(e => e.TopicId, "BcfComment_topicId_idx");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.Author).HasColumnName("author");
            entity.Property(e => e.Comment).HasColumnName("comment");
            entity.Property(e => e.Date)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("date");
            entity.Property(e => e.Guid).HasColumnName("guid");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.TopicId).HasColumnName("topicId");
            entity.Property(e => e.ViewpointGuid).HasColumnName("viewpointGuid");

            entity.HasOne(d => d.Topic).WithMany(p => p.BcfComment)
                .HasForeignKey(d => d.TopicId)
                .HasConstraintName("BcfComment_topicId_fkey");
        });

        modelBuilder.Entity<BcfTopic>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("BcfTopic_pkey");

            entity.HasIndex(e => new { e.OrganizationId, e.Guid }, "BcfTopic_organizationId_guid_key").IsUnique();

            entity.HasIndex(e => new { e.OrganizationId, e.PropertyId }, "BcfTopic_organizationId_propertyId_idx");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.AssignedTo).HasColumnName("assignedTo");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.CreationAuthor).HasColumnName("creationAuthor");
            entity.Property(e => e.CreationDate)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("creationDate");
            entity.Property(e => e.Description).HasColumnName("description");
            entity.Property(e => e.DueDate)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("dueDate");
            entity.Property(e => e.Guid).HasColumnName("guid");
            entity.Property(e => e.Labels)
                .HasDefaultValueSql("ARRAY[]::text[]")
                .HasColumnName("labels");
            entity.Property(e => e.ModifiedAuthor).HasColumnName("modifiedAuthor");
            entity.Property(e => e.ModifiedDate)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("modifiedDate");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.Priority).HasColumnName("priority");
            entity.Property(e => e.PropertyId).HasColumnName("propertyId");
            entity.Property(e => e.Title).HasColumnName("title");
            entity.Property(e => e.TopicStatus).HasColumnName("topicStatus");
            entity.Property(e => e.TopicType).HasColumnName("topicType");
            entity.Property(e => e.UpdatedAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("updatedAt");
            entity.Property(e => e.Version)
                .HasDefaultValue(1)
                .HasColumnName("version");

            entity.HasOne(d => d.Organization).WithMany(p => p.BcfTopic)
                .HasForeignKey(d => d.OrganizationId)
                .HasConstraintName("BcfTopic_organizationId_fkey");
        });

        modelBuilder.Entity<BcfTopicDevice>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("BcfTopicDevice_pkey");

            entity.HasIndex(e => e.DeviceId, "BcfTopicDevice_deviceId_idx");

            entity.HasIndex(e => new { e.TopicId, e.DeviceId }, "BcfTopicDevice_topicId_deviceId_key").IsUnique();

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.DeviceId).HasColumnName("deviceId");
            entity.Property(e => e.TopicId).HasColumnName("topicId");

            entity.HasOne(d => d.Topic).WithMany(p => p.BcfTopicDevice)
                .HasForeignKey(d => d.TopicId)
                .HasConstraintName("BcfTopicDevice_topicId_fkey");
        });

        modelBuilder.Entity<BcfViewpoint>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("BcfViewpoint_pkey");

            entity.HasIndex(e => e.TopicId, "BcfViewpoint_topicId_idx");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.Camera)
                .HasColumnType("jsonb")
                .HasColumnName("camera");
            entity.Property(e => e.ClippingPlanes)
                .HasColumnType("jsonb")
                .HasColumnName("clippingPlanes");
            entity.Property(e => e.Components)
                .HasColumnType("jsonb")
                .HasColumnName("components");
            entity.Property(e => e.Guid).HasColumnName("guid");
            entity.Property(e => e.IsPrimary)
                .HasDefaultValue(false)
                .HasColumnName("isPrimary");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.SnapshotKey).HasColumnName("snapshotKey");
            entity.Property(e => e.TopicId).HasColumnName("topicId");

            entity.HasOne(d => d.Topic).WithMany(p => p.BcfViewpoint)
                .HasForeignKey(d => d.TopicId)
                .HasConstraintName("BcfViewpoint_topicId_fkey");
        });

        modelBuilder.Entity<BuildingModel>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("BuildingModel_pkey");

            entity.HasIndex(e => e.ActiveVersionId, "BuildingModel_activeVersionId_key").IsUnique();

            entity.HasIndex(e => e.OrganizationId, "BuildingModel_organizationId_idx");

            entity.HasIndex(e => e.PropertyId, "BuildingModel_propertyId_key").IsUnique();

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.ActiveVersionId).HasColumnName("activeVersionId");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.Name).HasColumnName("name");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.PropertyId).HasColumnName("propertyId");
            entity.Property(e => e.UpdatedAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("updatedAt");
            entity.Property(e => e.Version)
                .HasDefaultValue(1)
                .HasColumnName("version");

            entity.HasOne(d => d.ActiveVersion).WithOne(p => p.BuildingModel)
                .HasForeignKey<BuildingModel>(d => d.ActiveVersionId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("BuildingModel_activeVersionId_fkey");

            entity.HasOne(d => d.Organization).WithMany(p => p.BuildingModel)
                .HasForeignKey(d => d.OrganizationId)
                .HasConstraintName("BuildingModel_organizationId_fkey");

            entity.HasOne(d => d.Property).WithOne(p => p.BuildingModel)
                .HasForeignKey<BuildingModel>(d => d.PropertyId)
                .OnDelete(DeleteBehavior.Restrict)
                .HasConstraintName("BuildingModel_propertyId_fkey");
        });

        modelBuilder.Entity<BuildingModelVersion>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("BuildingModelVersion_pkey");

            entity.HasIndex(e => e.BuildingModelId, "BuildingModelVersion_buildingModelId_idx");

            entity.HasIndex(e => new { e.BuildingModelId, e.VersionNumber }, "BuildingModelVersion_buildingModelId_versionNumber_key").IsUnique();

            entity.HasIndex(e => e.OrganizationId, "BuildingModelVersion_organizationId_idx");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.BuildingModelId).HasColumnName("buildingModelId");
            entity.Property(e => e.ContentHash).HasColumnName("contentHash");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.FileName).HasColumnName("fileName");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.SizeBytes).HasColumnName("sizeBytes");
            entity.Property(e => e.StorageKey).HasColumnName("storageKey");
            entity.Property(e => e.Units).HasColumnName("units");
            entity.Property(e => e.UploadedByMemberId).HasColumnName("uploadedByMemberId");
            entity.Property(e => e.VersionNumber).HasColumnName("versionNumber");

            entity.HasOne(d => d.BuildingModelNavigation).WithMany(p => p.BuildingModelVersion)
                .HasForeignKey(d => d.BuildingModelId)
                .HasConstraintName("BuildingModelVersion_buildingModelId_fkey");

            entity.HasOne(d => d.Organization).WithMany(p => p.BuildingModelVersion)
                .HasForeignKey(d => d.OrganizationId)
                .HasConstraintName("BuildingModelVersion_organizationId_fkey");
        });

        modelBuilder.Entity<ChangeLog>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("ChangeLog_pkey");

            // Scaffolding does not reverse-engineer CHECK constraints; added by hand from
            // the reference schema (the audited entity-type allowlist).
            entity.ToTable(tb => tb.HasCheckConstraint(
                "changelog_entity_type_check",
                "\"entityType\" IN ('Device', 'Circuit', 'FiberRun', 'DeviceConnection', 'Network', 'Property', 'NetworkProperty', 'Team', 'TeamMember', 'TeamProperty', 'MemberProperty', 'BuildingModel', 'BuildingModelVersion', 'MonitoringIngestToken', 'Agent', 'AgentEnrollmentCode', 'SnmpCredential', 'OidProfile', 'BcfTopic', 'BcfComment')"));

            entity.HasIndex(e => new { e.OrganizationId, e.CreatedAt }, "ChangeLog_organizationId_createdAt_idx").IsDescending(false, true);

            entity.HasIndex(e => new { e.OrganizationId, e.EntityType, e.EntityId }, "ChangeLog_organizationId_entityType_entityId_idx");

            entity.HasIndex(e => e.RequestId, "ChangeLog_requestId_idx");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.Comment).HasColumnName("comment");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.Action).HasColumnName("action");
            entity.Property(e => e.EntityId).HasColumnName("entityId");
            entity.Property(e => e.EntityType).HasColumnName("entityType");
            entity.Property(e => e.Field).HasColumnName("field");
            entity.Property(e => e.IpAddress).HasColumnName("ipAddress");
            entity.Property(e => e.NewValue).HasColumnName("newValue");
            entity.Property(e => e.OldValue).HasColumnName("oldValue");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.RequestId).HasColumnName("requestId");
            entity.Property(e => e.Snapshot)
                .HasColumnType("jsonb")
                .HasColumnName("snapshot");
            entity.Property(e => e.UserAgent).HasColumnName("userAgent");
            entity.Property(e => e.UserId).HasColumnName("userId");

            entity.HasOne(d => d.Organization).WithMany(p => p.ChangeLog)
                .HasForeignKey(d => d.OrganizationId)
                .HasConstraintName("ChangeLog_organizationId_fkey");

            entity.HasOne(d => d.User).WithMany(p => p.ChangeLog)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("ChangeLog_userId_fkey");
        });

        modelBuilder.Entity<Circuit>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("Circuit_pkey");

            entity.HasIndex(e => new { e.OrganizationId, e.DeviceId }, "Circuit_organizationId_deviceId_idx");

            entity.HasIndex(e => e.OrganizationId, "Circuit_organizationId_idx");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.Bandwidth).HasColumnName("bandwidth");
            entity.Property(e => e.CircuitId).HasColumnName("circuitId");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.DeviceId).HasColumnName("deviceId");
            entity.Property(e => e.IspName).HasColumnName("ispName");
            entity.Property(e => e.Notes).HasColumnName("notes");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.ServiceType).HasColumnName("serviceType");
            entity.Property(e => e.UpdatedAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("updatedAt");
            entity.Property(e => e.UserId).HasColumnName("userId");
            entity.Property(e => e.Version)
                .HasDefaultValue(1)
                .HasColumnName("version");

            entity.HasOne(d => d.Device).WithMany(p => p.Circuit)
                .HasForeignKey(d => d.DeviceId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("Circuit_deviceId_fkey");

            entity.HasOne(d => d.Organization).WithMany(p => p.Circuit)
                .HasForeignKey(d => d.OrganizationId)
                .HasConstraintName("Circuit_organizationId_fkey");

            entity.HasOne(d => d.User).WithMany(p => p.Circuit)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("Circuit_userId_fkey");
        });

        modelBuilder.Entity<Device>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("Device_pkey");

            entity.HasIndex(e => e.IpAddress, "Device_ipAddress_idx");

            entity.HasIndex(e => new { e.OrganizationId, e.Category }, "Device_organizationId_category_idx");

            entity.HasIndex(e => new { e.OrganizationId, e.CreatedAt }, "Device_organizationId_createdAt_idx");

            entity.HasIndex(e => new { e.OrganizationId, e.Floor }, "Device_organizationId_floor_idx");

            entity.HasIndex(e => e.OrganizationId, "Device_organizationId_idx");

            entity.HasIndex(e => new { e.OrganizationId, e.IfcGlobalId }, "Device_organizationId_ifcGlobalId_idx");

            entity.HasIndex(e => new { e.OrganizationId, e.NetworkId }, "Device_organizationId_networkId_idx");

            entity.HasIndex(e => new { e.OrganizationId, e.PropertyId }, "Device_organizationId_propertyId_idx");

            entity.HasIndex(e => e.Location, "device_location_idx").HasMethod("gist");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.Floor).HasColumnName("floor");
            entity.Property(e => e.Category).HasColumnName("category");
            entity.Property(e => e.FloorLabel).HasColumnName("floorLabel");
            entity.Property(e => e.IfcGlobalId).HasColumnName("ifcGlobalId");
            entity.Property(e => e.IpAddress).HasColumnName("ipAddress");
            entity.Property(e => e.Latitude).HasColumnName("latitude");
            entity.Property(e => e.Location)
                .HasColumnType("geometry(Point,4326)")
                .HasColumnName("location");
            entity.Property(e => e.Longitude).HasColumnName("longitude");
            entity.Property(e => e.MacAddress).HasColumnName("macAddress");
            entity.Property(e => e.Mobility)
                .HasDefaultValueSql("'UNKNOWN'::\"DeviceMobility\"")
                .HasColumnName("mobility");
            entity.Property(e => e.Name).HasColumnName("name");
            entity.Property(e => e.NetworkId).HasColumnName("networkId");
            entity.Property(e => e.Notes).HasColumnName("notes");
            entity.Property(e => e.OidProfileId).HasColumnName("oidProfileId");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.PropertyId).HasColumnName("propertyId");
            entity.Property(e => e.RoleCode).HasColumnName("roleCode");
            entity.Property(e => e.SnmpCredentialId).HasColumnName("snmpCredentialId");
            entity.Property(e => e.UpdatedAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("updatedAt");
            entity.Property(e => e.UserId).HasColumnName("userId");
            entity.Property(e => e.Version)
                .HasDefaultValue(1)
                .HasColumnName("version");
            entity.Property(e => e.X).HasColumnName("x");
            entity.Property(e => e.Y).HasColumnName("y");
            entity.Property(e => e.Z).HasColumnName("z");

            entity.HasOne(d => d.Network).WithMany(p => p.Device)
                .HasForeignKey(d => d.NetworkId)
                .OnDelete(DeleteBehavior.Restrict)
                .HasConstraintName("Device_networkId_fkey");

            entity.HasOne(d => d.OidProfile).WithMany(p => p.Device)
                .HasForeignKey(d => d.OidProfileId)
                .OnDelete(DeleteBehavior.Restrict)
                .HasConstraintName("Device_oidProfileId_fkey");

            entity.HasOne(d => d.Organization).WithMany(p => p.Device)
                .HasForeignKey(d => d.OrganizationId)
                .HasConstraintName("Device_organizationId_fkey");

            entity.HasOne(d => d.Property).WithMany(p => p.Device)
                .HasForeignKey(d => d.PropertyId)
                .OnDelete(DeleteBehavior.Restrict)
                .HasConstraintName("Device_propertyId_fkey");

            entity.HasOne(d => d.SnmpCredential).WithMany(p => p.Device)
                .HasForeignKey(d => d.SnmpCredentialId)
                .OnDelete(DeleteBehavior.Restrict)
                .HasConstraintName("Device_snmpCredentialId_fkey");

            entity.HasOne(d => d.User).WithMany(p => p.Device)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("Device_userId_fkey");
        });

        modelBuilder.Entity<DeviceConnection>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("DeviceConnection_pkey");

            entity.HasIndex(e => new { e.OrganizationId, e.SourceDeviceId }, "DeviceConnection_organizationId_sourceDeviceId_idx");

            entity.HasIndex(e => new { e.OrganizationId, e.TargetDeviceId }, "DeviceConnection_organizationId_targetDeviceId_idx");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.ConnectionType).HasColumnName("connectionType");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.Notes).HasColumnName("notes");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.SourceDeviceId).HasColumnName("sourceDeviceId");
            entity.Property(e => e.TargetDeviceId).HasColumnName("targetDeviceId");
            entity.Property(e => e.UpdatedAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("updatedAt");
            entity.Property(e => e.UserId).HasColumnName("userId");
            entity.Property(e => e.Version)
                .HasDefaultValue(1)
                .HasColumnName("version");

            entity.HasIndex(
                    e => new { e.OrganizationId, e.SourceDeviceId, e.TargetDeviceId, e.ConnectionType },
                    "DeviceConnection_organizationId_sourceDeviceId_targetDevice_key")
                .IsUnique();

            entity.HasOne(d => d.Organization).WithMany(p => p.DeviceConnection)
                .HasForeignKey(d => d.OrganizationId)
                .HasConstraintName("DeviceConnection_organizationId_fkey");

            entity.HasOne(d => d.SourceDevice).WithMany(p => p.DeviceConnectionSourceDevice)
                .HasForeignKey(d => d.SourceDeviceId)
                .HasConstraintName("DeviceConnection_sourceDeviceId_fkey");

            entity.HasOne(d => d.TargetDevice).WithMany(p => p.DeviceConnectionTargetDevice)
                .HasForeignKey(d => d.TargetDeviceId)
                .HasConstraintName("DeviceConnection_targetDeviceId_fkey");

            entity.HasOne(d => d.User).WithMany(p => p.DeviceConnection)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("DeviceConnection_userId_fkey");
        });

        modelBuilder.Entity<DeviceMetric>(entity =>
        {
            entity.HasKey(e => new { e.Id, e.Time }).HasName("DeviceMetric_pkey");

            entity.HasIndex(e => new { e.OrganizationId, e.DeviceId, e.Time }, "DeviceMetric_organizationId_deviceId_time_idx").IsDescending(false, false, true);

            entity.HasIndex(e => new { e.OrganizationId, e.SourceType, e.Time }, "DeviceMetric_organizationId_sourceType_time_idx").IsDescending(false, false, true);

            entity.HasIndex(e => new { e.OrganizationId, e.Time }, "DeviceMetric_organizationId_time_idx").IsDescending(false, true);

            entity.HasIndex(e => new { e.OrganizationId, e.UserId, e.Time }, "DeviceMetric_organizationId_userId_time_idx").IsDescending(false, false, true);

            entity.HasIndex(e => e.Time, "DeviceMetric_time_idx").IsDescending();

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.Time)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("time");
            entity.Property(e => e.BandwidthDown).HasColumnName("bandwidthDown");
            entity.Property(e => e.BandwidthUp).HasColumnName("bandwidthUp");
            entity.Property(e => e.ConnectionQuality).HasColumnName("connectionQuality");
            entity.Property(e => e.DeviceId).HasColumnName("deviceId");
            entity.Property(e => e.Latency).HasColumnName("latency");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.SourceType).HasColumnName("sourceType");
            entity.Property(e => e.Tag).HasColumnName("tag");
            entity.Property(e => e.UserId).HasColumnName("userId");
        });

        modelBuilder.Entity<DeviceStatus>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("DeviceStatus_pkey");

            entity.HasIndex(e => e.DeviceId, "DeviceStatus_deviceId_key").IsUnique();

            entity.HasIndex(e => e.OrganizationId, "DeviceStatus_organizationId_idx");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.ConsecutiveFails)
                .HasDefaultValue(0)
                .HasColumnName("consecutiveFails");
            entity.Property(e => e.DeviceId).HasColumnName("deviceId");
            entity.Property(e => e.LastChangeAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("lastChangeAt");
            entity.Property(e => e.LastCheckAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("lastCheckAt");
            entity.Property(e => e.LastOkAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("lastOkAt");
            entity.Property(e => e.LatencyMs).HasColumnName("latencyMs");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.Source).HasColumnName("source");
            entity.Property(e => e.State)
                .HasDefaultValueSql("'UNKNOWN'::\"DeviceStatusState\"")
                .HasColumnName("state");
            entity.Property(e => e.UpdatedAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("updatedAt");

            entity.HasOne(d => d.Device).WithOne(p => p.DeviceStatus)
                .HasForeignKey<DeviceStatus>(d => d.DeviceId)
                .HasConstraintName("DeviceStatus_deviceId_fkey");

            entity.HasOne(d => d.Organization).WithMany(p => p.DeviceStatus)
                .HasForeignKey(d => d.OrganizationId)
                .HasConstraintName("DeviceStatus_organizationId_fkey");
        });

        modelBuilder.Entity<DeviceStatusEvent>(entity =>
        {
            entity.HasNoKey();

            entity.HasIndex(e => e.Time, "DeviceStatusEvent_time_idx").IsDescending();

            entity.HasIndex(e => new { e.DeviceId, e.Time }, "device_status_event_dev_time").IsDescending(false, true);

            entity.Property(e => e.DeviceId).HasColumnName("deviceId");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.Source).HasColumnName("source");
            entity.Property(e => e.State).HasColumnName("state");
            entity.Property(e => e.Time).HasColumnName("time");
        });

        modelBuilder.Entity<FiberRun>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("FiberRun_pkey");

            entity.HasIndex(e => new { e.OrganizationId, e.EndDeviceId }, "FiberRun_organizationId_endDeviceId_idx");

            entity.HasIndex(e => e.OrganizationId, "FiberRun_organizationId_idx");

            entity.HasIndex(e => new { e.OrganizationId, e.StartDeviceId }, "FiberRun_organizationId_startDeviceId_idx");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.CableType).HasColumnName("cableType");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.EndDeviceId).HasColumnName("endDeviceId");
            entity.Property(e => e.LengthMeters).HasColumnName("lengthMeters");
            entity.Property(e => e.Name).HasColumnName("name");
            entity.Property(e => e.Notes).HasColumnName("notes");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.StartDeviceId).HasColumnName("startDeviceId");
            entity.Property(e => e.UpdatedAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("updatedAt");
            entity.Property(e => e.UserId).HasColumnName("userId");
            entity.Property(e => e.Version)
                .HasDefaultValue(1)
                .HasColumnName("version");

            entity.HasOne(d => d.EndDevice).WithMany(p => p.FiberRunEndDevice)
                .HasForeignKey(d => d.EndDeviceId)
                .HasConstraintName("FiberRun_endDeviceId_fkey");

            entity.HasOne(d => d.Organization).WithMany(p => p.FiberRun)
                .HasForeignKey(d => d.OrganizationId)
                .HasConstraintName("FiberRun_organizationId_fkey");

            entity.HasOne(d => d.StartDevice).WithMany(p => p.FiberRunStartDevice)
                .HasForeignKey(d => d.StartDeviceId)
                .HasConstraintName("FiberRun_startDeviceId_fkey");

            entity.HasOne(d => d.User).WithMany(p => p.FiberRun)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("FiberRun_userId_fkey");
        });

        modelBuilder.Entity<Invitation>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("Invitation_pkey");

            entity.HasIndex(e => e.Email, "Invitation_email_idx");

            entity.HasIndex(e => e.OrganizationId, "Invitation_organizationId_idx");

            entity.HasIndex(e => e.Token, "Invitation_token_key").IsUnique();

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.AcceptedAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("acceptedAt");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.Email).HasColumnName("email");
            entity.Property(e => e.ExpiresAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("expiresAt");
            entity.Property(e => e.InvitedByUserId).HasColumnName("invitedByUserId");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.Role)
                .HasDefaultValueSql("'MEMBER'::\"OrgRole\"")
                .HasColumnName("role");
            entity.Property(e => e.Token).HasColumnName("token");

            entity.HasOne(d => d.Organization).WithMany(p => p.Invitation)
                .HasForeignKey(d => d.OrganizationId)
                .HasConstraintName("Invitation_organizationId_fkey");
        });

        modelBuilder.Entity<JoinRequest>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("JoinRequest_pkey");

            entity.HasIndex(e => new { e.OrganizationId, e.Status }, "JoinRequest_organizationId_status_idx");

            entity.HasIndex(e => e.UserId, "JoinRequest_userId_idx");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.DecidedAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("decidedAt");
            entity.Property(e => e.DecidedByUserId).HasColumnName("decidedByUserId");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.Status)
                .HasDefaultValueSql("'PENDING'::\"JoinRequestStatus\"")
                .HasColumnName("status");
            entity.Property(e => e.UserId).HasColumnName("userId");

            entity.HasOne(d => d.Organization).WithMany(p => p.JoinRequest)
                .HasForeignKey(d => d.OrganizationId)
                .HasConstraintName("JoinRequest_organizationId_fkey");

            entity.HasOne(d => d.User).WithMany(p => p.JoinRequest)
                .HasForeignKey(d => d.UserId)
                .HasConstraintName("JoinRequest_userId_fkey");
        });

        modelBuilder.Entity<MemberProperty>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("MemberProperty_pkey");

            entity.HasIndex(e => new { e.MemberId, e.PropertyId }, "MemberProperty_memberId_propertyId_key").IsUnique();

            entity.HasIndex(e => e.OrganizationId, "MemberProperty_organizationId_idx");

            entity.HasIndex(e => e.PropertyId, "MemberProperty_propertyId_idx");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.MemberId).HasColumnName("memberId");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.PropertyId).HasColumnName("propertyId");

            entity.HasOne(d => d.Member).WithMany(p => p.MemberProperty)
                .HasForeignKey(d => d.MemberId)
                .HasConstraintName("MemberProperty_memberId_fkey");

            entity.HasOne(d => d.Organization).WithMany(p => p.MemberProperty)
                .HasForeignKey(d => d.OrganizationId)
                .HasConstraintName("MemberProperty_organizationId_fkey");

            entity.HasOne(d => d.Property).WithMany(p => p.MemberProperty)
                .HasForeignKey(d => d.PropertyId)
                .OnDelete(DeleteBehavior.Restrict)
                .HasConstraintName("MemberProperty_propertyId_fkey");
        });

        modelBuilder.Entity<MonitoringIngestToken>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("MonitoringIngestToken_pkey");

            entity.HasIndex(e => e.OrganizationId, "MonitoringIngestToken_organizationId_key").IsUnique();

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.TokenHash).HasColumnName("tokenHash");
            entity.Property(e => e.UpdatedAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("updatedAt");

            entity.HasOne(d => d.Organization).WithOne(p => p.MonitoringIngestToken)
                .HasForeignKey<MonitoringIngestToken>(d => d.OrganizationId)
                .HasConstraintName("MonitoringIngestToken_organizationId_fkey");
        });

        modelBuilder.Entity<MonitoringMetric>(entity =>
        {
            entity.HasNoKey();

            entity.HasIndex(e => e.Time, "MonitoringMetric_time_idx").IsDescending();

            entity.HasIndex(e => new { e.DeviceId, e.Metric, e.Time }, "monitoring_metric_dev_metric_time").IsDescending(false, false, true);

            entity.Property(e => e.DeviceId).HasColumnName("deviceId");
            entity.Property(e => e.Metric).HasColumnName("metric");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.Source).HasColumnName("source");
            entity.Property(e => e.Time).HasColumnName("time");
            entity.Property(e => e.Value).HasColumnName("value");
        });

        modelBuilder.Entity<Network>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("Network_pkey");

            entity.HasIndex(e => e.OrganizationId, "Network_organizationId_idx");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.DownMbps).HasColumnName("downMbps");
            entity.Property(e => e.HomeAddress).HasColumnName("homeAddress");
            entity.Property(e => e.HomeLatitude).HasColumnName("homeLatitude");
            entity.Property(e => e.HomeLongitude).HasColumnName("homeLongitude");
            entity.Property(e => e.HomePublicIp).HasColumnName("homePublicIp");
            entity.Property(e => e.Isp).HasColumnName("isp");
            entity.Property(e => e.Name).HasColumnName("name");
            entity.Property(e => e.OidProfileId).HasColumnName("oidProfileId");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.SnmpCredentialId).HasColumnName("snmpCredentialId");
            entity.Property(e => e.UpMbps).HasColumnName("upMbps");
            entity.Property(e => e.UpdatedAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("updatedAt");
            entity.Property(e => e.UserId).HasColumnName("userId");
            entity.Property(e => e.Version)
                .HasDefaultValue(1)
                .HasColumnName("version");

            entity.HasOne(d => d.OidProfile).WithMany(p => p.Network)
                .HasForeignKey(d => d.OidProfileId)
                .OnDelete(DeleteBehavior.Restrict)
                .HasConstraintName("Network_oidProfileId_fkey");

            entity.HasOne(d => d.Organization).WithMany(p => p.Network)
                .HasForeignKey(d => d.OrganizationId)
                .HasConstraintName("Network_organizationId_fkey");

            entity.HasOne(d => d.SnmpCredential).WithMany(p => p.Network)
                .HasForeignKey(d => d.SnmpCredentialId)
                .OnDelete(DeleteBehavior.Restrict)
                .HasConstraintName("Network_snmpCredentialId_fkey");

            entity.HasOne(d => d.User).WithMany(p => p.Network)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("Network_userId_fkey");
        });

        modelBuilder.Entity<NetworkProperty>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("NetworkProperty_pkey");

            entity.HasIndex(e => new { e.NetworkId, e.PropertyId }, "NetworkProperty_networkId_propertyId_key").IsUnique();

            entity.HasIndex(e => e.OrganizationId, "NetworkProperty_organizationId_idx");

            entity.HasIndex(e => e.PropertyId, "NetworkProperty_propertyId_idx");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.NetworkId).HasColumnName("networkId");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.PropertyId).HasColumnName("propertyId");

            entity.HasOne(d => d.Network).WithMany(p => p.NetworkProperty)
                .HasForeignKey(d => d.NetworkId)
                .HasConstraintName("NetworkProperty_networkId_fkey");

            entity.HasOne(d => d.Organization).WithMany(p => p.NetworkProperty)
                .HasForeignKey(d => d.OrganizationId)
                .HasConstraintName("NetworkProperty_organizationId_fkey");

            entity.HasOne(d => d.Property).WithMany(p => p.NetworkProperty)
                .HasForeignKey(d => d.PropertyId)
                .OnDelete(DeleteBehavior.Restrict)
                .HasConstraintName("NetworkProperty_propertyId_fkey");
        });

        modelBuilder.Entity<OidEntry>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("OidEntry_pkey");

            entity.HasIndex(e => new { e.OidProfileId, e.Oid }, "OidEntry_oidProfileId_oid_key").IsUnique();

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.Metric).HasColumnName("metric");
            entity.Property(e => e.Oid).HasColumnName("oid");
            entity.Property(e => e.OidProfileId).HasColumnName("oidProfileId");

            entity.HasOne(d => d.OidProfile).WithMany(p => p.OidEntry)
                .HasForeignKey(d => d.OidProfileId)
                .HasConstraintName("OidEntry_oidProfileId_fkey");
        });

        modelBuilder.Entity<OidProfile>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("OidProfile_pkey");

            entity.HasIndex(e => e.OrganizationId, "OidProfile_organizationId_idx");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.IncludeInterfaceMetrics)
                .HasDefaultValue(false)
                .HasColumnName("includeInterfaceMetrics");
            entity.Property(e => e.Name).HasColumnName("name");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.UpdatedAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("updatedAt");
            entity.Property(e => e.Version)
                .HasDefaultValue(1)
                .HasColumnName("version");

            entity.HasOne(d => d.Organization).WithMany(p => p.OidProfile)
                .HasForeignKey(d => d.OrganizationId)
                .HasConstraintName("OidProfile_organizationId_fkey");
        });

        modelBuilder.Entity<Organization>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("Organization_pkey");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.Name).HasColumnName("name");
            entity.Property(e => e.NamingMaxLen)
                .HasDefaultValue(63)
                .HasColumnName("namingMaxLen");
            entity.Property(e => e.NamingPattern).HasColumnName("namingPattern");
            entity.Property(e => e.NamingTemplate).HasColumnName("namingTemplate");
            entity.Property(e => e.UpdatedAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("updatedAt");
            entity.Property(e => e.Version)
                .HasDefaultValue(1)
                .HasColumnName("version");
        });

        modelBuilder.Entity<OrganizationDomain>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("OrganizationDomain_pkey");

            entity.HasIndex(e => e.Domain, "OrganizationDomain_domain_key").IsUnique();

            entity.HasIndex(e => e.OrganizationId, "OrganizationDomain_organizationId_idx");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.Domain).HasColumnName("domain");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.Verified)
                .HasDefaultValue(false)
                .HasColumnName("verified");

            entity.HasOne(d => d.Organization).WithMany(p => p.OrganizationDomain)
                .HasForeignKey(d => d.OrganizationId)
                .HasConstraintName("OrganizationDomain_organizationId_fkey");
        });

        modelBuilder.Entity<OrganizationMember>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("OrganizationMember_pkey");

            entity.HasIndex(e => e.OrganizationId, "OrganizationMember_organizationId_idx");

            entity.HasIndex(e => e.UserId, "OrganizationMember_userId_key").IsUnique();

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.Role)
                .HasDefaultValueSql("'MEMBER'::\"OrgRole\"")
                // Owner is enum value 0 - the CLR default - so without an out-of-range
                // sentinel EF omits an explicit Role=Owner from the INSERT and the
                // database default silently demotes the row to MEMBER (the seeder hit
                // exactly this: a grant-less "owner" who saw an empty org).
                .HasSentinel((OrgRole)(-1))
                .HasColumnName("role");
            entity.Property(e => e.UpdatedAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("updatedAt");
            entity.Property(e => e.UserId).HasColumnName("userId");

            entity.HasOne(d => d.Organization).WithMany(p => p.OrganizationMember)
                .HasForeignKey(d => d.OrganizationId)
                .HasConstraintName("OrganizationMember_organizationId_fkey");

            entity.HasOne(d => d.User).WithOne(p => p.OrganizationMember)
                .HasForeignKey<OrganizationMember>(d => d.UserId)
                .HasConstraintName("OrganizationMember_userId_fkey");
        });


        modelBuilder.Entity<Property>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("Property_pkey");

            entity.HasIndex(e => e.OrganizationId, "Property_organizationId_idx");

            entity.HasIndex(e => new { e.OrganizationId, e.ParentId }, "Property_organizationId_parentId_idx");

            entity.HasIndex(e => new { e.OrganizationId, e.Type }, "Property_organizationId_type_idx");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.Code).HasColumnName("code");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.Name).HasColumnName("name");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.ParentId).HasColumnName("parentId");
            entity.Property(e => e.Type).HasColumnName("type");
            entity.Property(e => e.UpdatedAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("updatedAt");
            entity.Property(e => e.Version)
                .HasDefaultValue(1)
                .HasColumnName("version");

            entity.HasOne(d => d.Organization).WithMany(p => p.Property)
                .HasForeignKey(d => d.OrganizationId)
                .HasConstraintName("Property_organizationId_fkey");

            entity.HasOne(d => d.Parent).WithMany(p => p.InverseParent)
                .HasForeignKey(d => d.ParentId)
                .OnDelete(DeleteBehavior.Restrict)
                .HasConstraintName("Property_parentId_fkey");
        });

        modelBuilder.Entity<Session>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("Session_pkey");

            entity.HasIndex(e => e.Token, "Session_token_idx");

            entity.HasIndex(e => e.Token, "Session_token_key").IsUnique();

            entity.HasIndex(e => e.UserId, "Session_userId_idx");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.ExpiresAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("expiresAt");
            entity.Property(e => e.IpAddress).HasColumnName("ipAddress");
            entity.Property(e => e.Token).HasColumnName("token");
            entity.Property(e => e.UpdatedAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("updatedAt");
            entity.Property(e => e.UserAgent).HasColumnName("userAgent");
            entity.Property(e => e.UserId).HasColumnName("userId");

            entity.HasOne(d => d.User).WithMany(p => p.Session)
                .HasForeignKey(d => d.UserId)
                .HasConstraintName("Session_userId_fkey");
        });

        modelBuilder.Entity<SnmpCredential>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("SnmpCredential_pkey");

            entity.HasIndex(e => e.OrganizationId, "SnmpCredential_organizationId_idx");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.AuthKeyEnc).HasColumnName("authKeyEnc");
            entity.Property(e => e.AuthProtocol).HasColumnName("authProtocol");
            entity.Property(e => e.CommunityEnc).HasColumnName("communityEnc");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.Name).HasColumnName("name");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.PrivKeyEnc).HasColumnName("privKeyEnc");
            entity.Property(e => e.PrivProtocol).HasColumnName("privProtocol");
            entity.Property(e => e.SecurityLevel).HasColumnName("securityLevel");
            entity.Property(e => e.SecurityName).HasColumnName("securityName");
            entity.Property(e => e.SnmpVersion).HasColumnName("snmpVersion");
            entity.Property(e => e.UpdatedAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("updatedAt");
            entity.Property(e => e.Version)
                .HasDefaultValue(1)
                .HasColumnName("version");

            entity.HasOne(d => d.Organization).WithMany(p => p.SnmpCredential)
                .HasForeignKey(d => d.OrganizationId)
                .HasConstraintName("SnmpCredential_organizationId_fkey");
        });

        modelBuilder.Entity<Team>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("Team_pkey");

            entity.HasIndex(e => e.CreatorMemberId, "Team_creatorMemberId_idx");

            entity.HasIndex(e => e.OrganizationId, "Team_organizationId_idx");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.CreatorMemberId).HasColumnName("creatorMemberId");
            entity.Property(e => e.Name).HasColumnName("name");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.UpdatedAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("updatedAt");
            entity.Property(e => e.Version)
                .HasDefaultValue(1)
                .HasColumnName("version");

            entity.HasOne(d => d.CreatorMember).WithMany(p => p.Team)
                .HasForeignKey(d => d.CreatorMemberId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("Team_creatorMemberId_fkey");

            entity.HasOne(d => d.Organization).WithMany(p => p.Team)
                .HasForeignKey(d => d.OrganizationId)
                .HasConstraintName("Team_organizationId_fkey");
        });

        modelBuilder.Entity<TeamMember>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("TeamMember_pkey");

            entity.HasIndex(e => e.MemberId, "TeamMember_memberId_idx");

            entity.HasIndex(e => e.OrganizationId, "TeamMember_organizationId_idx");

            entity.HasIndex(e => new { e.TeamId, e.MemberId }, "TeamMember_teamId_memberId_key").IsUnique();

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.MemberId).HasColumnName("memberId");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.TeamId).HasColumnName("teamId");

            entity.HasOne(d => d.Member).WithMany(p => p.TeamMember)
                .HasForeignKey(d => d.MemberId)
                .HasConstraintName("TeamMember_memberId_fkey");

            entity.HasOne(d => d.Organization).WithMany(p => p.TeamMember)
                .HasForeignKey(d => d.OrganizationId)
                .HasConstraintName("TeamMember_organizationId_fkey");

            entity.HasOne(d => d.Team).WithMany(p => p.TeamMember)
                .HasForeignKey(d => d.TeamId)
                .HasConstraintName("TeamMember_teamId_fkey");
        });

        modelBuilder.Entity<TeamProperty>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("TeamProperty_pkey");

            entity.HasIndex(e => e.OrganizationId, "TeamProperty_organizationId_idx");

            entity.HasIndex(e => e.PropertyId, "TeamProperty_propertyId_idx");

            entity.HasIndex(e => new { e.TeamId, e.PropertyId }, "TeamProperty_teamId_propertyId_key").IsUnique();

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.OrganizationId).HasColumnName("organizationId");
            entity.Property(e => e.PropertyId).HasColumnName("propertyId");
            entity.Property(e => e.TeamId).HasColumnName("teamId");

            entity.HasOne(d => d.Organization).WithMany(p => p.TeamProperty)
                .HasForeignKey(d => d.OrganizationId)
                .HasConstraintName("TeamProperty_organizationId_fkey");

            entity.HasOne(d => d.Property).WithMany(p => p.TeamProperty)
                .HasForeignKey(d => d.PropertyId)
                .OnDelete(DeleteBehavior.Restrict)
                .HasConstraintName("TeamProperty_propertyId_fkey");

            entity.HasOne(d => d.Team).WithMany(p => p.TeamProperty)
                .HasForeignKey(d => d.TeamId)
                .HasConstraintName("TeamProperty_teamId_fkey");
        });

        modelBuilder.Entity<User>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("User_pkey");

            entity.HasIndex(e => e.Email, "User_email_key").IsUnique();

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.Email).HasColumnName("email");
            entity.Property(e => e.EmailVerified)
                .HasDefaultValue(false)
                .HasColumnName("emailVerified");
            entity.Property(e => e.HomeLatitude).HasColumnName("homeLatitude");
            entity.Property(e => e.HomeLongitude).HasColumnName("homeLongitude");
            entity.Property(e => e.Image).HasColumnName("image");
            entity.Property(e => e.IsSuperAdmin)
                .HasDefaultValue(false)
                .HasColumnName("isSuperAdmin");
            entity.Property(e => e.MapPreferences)
                .HasDefaultValueSql("'{}'::jsonb")
                .HasColumnType("jsonb")
                .HasColumnName("mapPreferences");
            entity.Property(e => e.Name).HasColumnName("name");
            entity.Property(e => e.OnboardingCompletedAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("onboardingCompletedAt");
            entity.Property(e => e.Tier)
                .HasDefaultValueSql("'PERSONAL_FREE'::\"AccountTier\"")
                .HasColumnName("tier");
            entity.Property(e => e.UpdatedAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("updatedAt");
        });

        modelBuilder.Entity<Verification>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("Verification_pkey");

            entity.HasIndex(e => e.Identifier, "Verification_identifier_idx");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("createdAt");
            entity.Property(e => e.ExpiresAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("expiresAt");
            entity.Property(e => e.Identifier).HasColumnName("identifier");
            entity.Property(e => e.UpdatedAt)
                .HasColumnType("timestamp(3) without time zone")
                .HasColumnName("updatedAt");
            entity.Property(e => e.Value).HasColumnName("value");
        });
        OnModelCreatingPartial(modelBuilder);
    }

    partial void OnModelCreatingPartial(ModelBuilder modelBuilder);
}
