using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;
using NetTopologySuite.Geometries;
using NodeScope.Migrations.Entities;

#nullable disable

namespace NodeScope.Migrations.Migrations
{
    /// <inheritdoc />
    public partial class Initial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .Annotation("Npgsql:Enum:AccountTier", "PERSONAL_FREE,PERSONAL_PAID,MULTI_PROPERTY,ENTERPRISE")
                .Annotation("Npgsql:Enum:AgentStatus", "PENDING,APPROVED,REVOKED")
                .Annotation("Npgsql:Enum:ChangeAction", "CREATE,UPDATE,DELETE")
                .Annotation("Npgsql:Enum:ConnectionType", "ETHERNET,FIBER,WIFI,LOGICAL")
                .Annotation("Npgsql:Enum:DeviceCategory", "RAD,ONT,DSLAM,ROUTER,MODEM,FIBER_MEDIA_CONVERTER,FIREWALL,SWITCH,ACCESS_POINT,WIFI_EXTENDER,WIRELESS_BRIDGE,SERVER_RACK,PATCH_PANEL,UPS,COMPUTER,PHONE,TABLET,PRINTER,IOT_DEVICE,CUSTOM")
                .Annotation("Npgsql:Enum:DeviceMobility", "HOME_ONLY,ROAMS,UNKNOWN")
                .Annotation("Npgsql:Enum:DeviceStatusState", "UP,DOWN,WARNING,UNKNOWN")
                .Annotation("Npgsql:Enum:JoinRequestStatus", "PENDING,APPROVED,DENIED")
                .Annotation("Npgsql:Enum:OrgRole", "OWNER,ADMIN,MEMBER")
                .Annotation("Npgsql:Enum:PropertyType", "SITE,BUILDING,FLOOR,AREA")
                .Annotation("Npgsql:Enum:SnmpAuthProtocol", "MD5,SHA,SHA256")
                .Annotation("Npgsql:Enum:SnmpPrivProtocol", "DES,AES,AES256")
                .Annotation("Npgsql:Enum:SnmpSecurityLevel", "NO_AUTH_NO_PRIV,AUTH_NO_PRIV,AUTH_PRIV")
                .Annotation("Npgsql:Enum:SnmpVersion", "V2C,V3")
                .Annotation("Npgsql:PostgresExtension:postgis", ",,")
                .Annotation("Npgsql:PostgresExtension:timescaledb", ",,")
                .Annotation("Npgsql:PostgresExtension:timescaledb_toolkit", ",,");

            migrationBuilder.CreateTable(
                name: "DeviceMetric",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    time = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    userId = table.Column<string>(type: "text", nullable: false),
                    sourceType = table.Column<string>(type: "text", nullable: false),
                    bandwidthDown = table.Column<double>(type: "double precision", nullable: true),
                    bandwidthUp = table.Column<double>(type: "double precision", nullable: true),
                    latency = table.Column<double>(type: "double precision", nullable: true),
                    connectionQuality = table.Column<string>(type: "text", nullable: true),
                    deviceId = table.Column<string>(type: "text", nullable: true),
                    tag = table.Column<string>(type: "text", nullable: true),
                    organizationId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("DeviceMetric_pkey", x => new { x.id, x.time });
                });

            migrationBuilder.CreateTable(
                name: "DeviceStatusEvent",
                columns: table => new
                {
                    time = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    deviceId = table.Column<string>(type: "text", nullable: false),
                    state = table.Column<string>(type: "text", nullable: false),
                    source = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                });

            migrationBuilder.CreateTable(
                name: "MonitoringMetric",
                columns: table => new
                {
                    time = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    deviceId = table.Column<string>(type: "text", nullable: false),
                    metric = table.Column<string>(type: "text", nullable: false),
                    value = table.Column<double>(type: "double precision", nullable: false),
                    source = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                });

            migrationBuilder.CreateTable(
                name: "Organization",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    name = table.Column<string>(type: "text", nullable: false),
                    namingPattern = table.Column<string>(type: "text", nullable: true),
                    namingMaxLen = table.Column<int>(type: "integer", nullable: true, defaultValue: 63),
                    version = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false),
                    namingTemplate = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("Organization_pkey", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "User",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    email = table.Column<string>(type: "text", nullable: false),
                    emailVerified = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    name = table.Column<string>(type: "text", nullable: true),
                    image = table.Column<string>(type: "text", nullable: true),
                    homeLatitude = table.Column<double>(type: "double precision", nullable: true),
                    homeLongitude = table.Column<double>(type: "double precision", nullable: true),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false),
                    tier = table.Column<AccountTier>(type: "\"AccountTier\"", nullable: false, defaultValueSql: "'PERSONAL_FREE'::\"AccountTier\""),
                    mapPreferences = table.Column<string>(type: "jsonb", nullable: false, defaultValueSql: "'{}'::jsonb"),
                    onboardingCompletedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    isSuperAdmin = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("User_pkey", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "Verification",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    identifier = table.Column<string>(type: "text", nullable: false),
                    value = table.Column<string>(type: "text", nullable: false),
                    expiresAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("Verification_pkey", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "Agent",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    name = table.Column<string>(type: "text", nullable: false),
                    platform = table.Column<string>(type: "text", nullable: true),
                    version = table.Column<string>(type: "text", nullable: true),
                    status = table.Column<AgentStatus>(type: "\"AgentStatus\"", nullable: false, defaultValueSql: "'APPROVED'::\"AgentStatus\""),
                    lastSeenAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    tokenHash = table.Column<string>(type: "text", nullable: false),
                    createdByMemberId = table.Column<string>(type: "text", nullable: true),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("Agent_pkey", x => x.id);
                    table.ForeignKey(
                        name: "Agent_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "AgentEnrollmentCode",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    codeHash = table.Column<string>(type: "text", nullable: false),
                    expiresAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false),
                    createdByMemberId = table.Column<string>(type: "text", nullable: true),
                    usedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("AgentEnrollmentCode_pkey", x => x.id);
                    table.ForeignKey(
                        name: "AgentEnrollmentCode_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BcfTopic",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    propertyId = table.Column<string>(type: "text", nullable: false),
                    guid = table.Column<string>(type: "text", nullable: false),
                    title = table.Column<string>(type: "text", nullable: false),
                    topicType = table.Column<string>(type: "text", nullable: true),
                    topicStatus = table.Column<string>(type: "text", nullable: true),
                    priority = table.Column<string>(type: "text", nullable: true),
                    labels = table.Column<List<string>>(type: "text[]", nullable: true, defaultValueSql: "ARRAY[]::text[]"),
                    creationAuthor = table.Column<string>(type: "text", nullable: false),
                    creationDate = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false),
                    modifiedAuthor = table.Column<string>(type: "text", nullable: true),
                    modifiedDate = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    assignedTo = table.Column<string>(type: "text", nullable: true),
                    dueDate = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    description = table.Column<string>(type: "text", nullable: true),
                    version = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("BcfTopic_pkey", x => x.id);
                    table.ForeignKey(
                        name: "BcfTopic_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Invitation",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    email = table.Column<string>(type: "text", nullable: false),
                    token = table.Column<string>(type: "text", nullable: false),
                    role = table.Column<OrgRole>(type: "\"OrgRole\"", nullable: false, defaultValueSql: "'MEMBER'::\"OrgRole\""),
                    expiresAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false),
                    invitedByUserId = table.Column<string>(type: "text", nullable: true),
                    acceptedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("Invitation_pkey", x => x.id);
                    table.ForeignKey(
                        name: "Invitation_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "MonitoringIngestToken",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    tokenHash = table.Column<string>(type: "text", nullable: false),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("MonitoringIngestToken_pkey", x => x.id);
                    table.ForeignKey(
                        name: "MonitoringIngestToken_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "OidProfile",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    name = table.Column<string>(type: "text", nullable: false),
                    includeInterfaceMetrics = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    version = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("OidProfile_pkey", x => x.id);
                    table.ForeignKey(
                        name: "OidProfile_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "OrganizationDomain",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    domain = table.Column<string>(type: "text", nullable: false),
                    verified = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("OrganizationDomain_pkey", x => x.id);
                    table.ForeignKey(
                        name: "OrganizationDomain_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Property",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    parentId = table.Column<string>(type: "text", nullable: true),
                    name = table.Column<string>(type: "text", nullable: false),
                    type = table.Column<PropertyType>(type: "\"PropertyType\"", nullable: false),
                    code = table.Column<string>(type: "text", nullable: true),
                    version = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("Property_pkey", x => x.id);
                    table.ForeignKey(
                        name: "Property_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "Property_parentId_fkey",
                        column: x => x.parentId,
                        principalTable: "Property",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SnmpCredential",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    name = table.Column<string>(type: "text", nullable: false),
                    snmpVersion = table.Column<SnmpVersion>(type: "\"SnmpVersion\"", nullable: false),
                    securityLevel = table.Column<SnmpSecurityLevel>(type: "\"SnmpSecurityLevel\"", nullable: true),
                    authProtocol = table.Column<SnmpAuthProtocol>(type: "\"SnmpAuthProtocol\"", nullable: true),
                    privProtocol = table.Column<SnmpPrivProtocol>(type: "\"SnmpPrivProtocol\"", nullable: true),
                    securityName = table.Column<string>(type: "text", nullable: true),
                    communityEnc = table.Column<string>(type: "text", nullable: true),
                    authKeyEnc = table.Column<string>(type: "text", nullable: true),
                    privKeyEnc = table.Column<string>(type: "text", nullable: true),
                    version = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("SnmpCredential_pkey", x => x.id);
                    table.ForeignKey(
                        name: "SnmpCredential_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Account",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    userId = table.Column<string>(type: "text", nullable: false),
                    accountId = table.Column<string>(type: "text", nullable: false),
                    providerId = table.Column<string>(type: "text", nullable: false),
                    accessToken = table.Column<string>(type: "text", nullable: true),
                    refreshToken = table.Column<string>(type: "text", nullable: true),
                    accessTokenExpiresAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    refreshTokenExpiresAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    scope = table.Column<string>(type: "text", nullable: true),
                    idToken = table.Column<string>(type: "text", nullable: true),
                    password = table.Column<string>(type: "text", nullable: true),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("Account_pkey", x => x.id);
                    table.ForeignKey(
                        name: "Account_userId_fkey",
                        column: x => x.userId,
                        principalTable: "User",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ChangeLog",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    userId = table.Column<string>(type: "text", nullable: true),
                    action = table.Column<ChangeAction>(type: "\"ChangeAction\"", nullable: false),
                    entityType = table.Column<string>(type: "text", nullable: false),
                    entityId = table.Column<string>(type: "text", nullable: false),
                    field = table.Column<string>(type: "text", nullable: true),
                    oldValue = table.Column<string>(type: "text", nullable: true),
                    newValue = table.Column<string>(type: "text", nullable: true),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    comment = table.Column<string>(type: "text", nullable: true),
                    ipAddress = table.Column<string>(type: "text", nullable: true),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    requestId = table.Column<string>(type: "text", nullable: false),
                    snapshot = table.Column<string>(type: "jsonb", nullable: true),
                    userAgent = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("ChangeLog_pkey", x => x.id);
                    table.CheckConstraint("changelog_entity_type_check", "\"entityType\" IN ('Device', 'Circuit', 'FiberRun', 'DeviceConnection', 'Network', 'Property', 'NetworkProperty', 'Team', 'TeamMember', 'TeamProperty', 'MemberProperty', 'BuildingModel', 'BuildingModelVersion', 'MonitoringIngestToken', 'Agent', 'AgentEnrollmentCode', 'SnmpCredential', 'OidProfile', 'BcfTopic', 'BcfComment')");
                    table.ForeignKey(
                        name: "ChangeLog_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "ChangeLog_userId_fkey",
                        column: x => x.userId,
                        principalTable: "User",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "JoinRequest",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    userId = table.Column<string>(type: "text", nullable: false),
                    status = table.Column<JoinRequestStatus>(type: "\"JoinRequestStatus\"", nullable: false, defaultValueSql: "'PENDING'::\"JoinRequestStatus\""),
                    decidedByUserId = table.Column<string>(type: "text", nullable: true),
                    decidedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("JoinRequest_pkey", x => x.id);
                    table.ForeignKey(
                        name: "JoinRequest_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "JoinRequest_userId_fkey",
                        column: x => x.userId,
                        principalTable: "User",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "OrganizationMember",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    userId = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    role = table.Column<OrgRole>(type: "\"OrgRole\"", nullable: false, defaultValueSql: "'MEMBER'::\"OrgRole\""),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("OrganizationMember_pkey", x => x.id);
                    table.ForeignKey(
                        name: "OrganizationMember_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "OrganizationMember_userId_fkey",
                        column: x => x.userId,
                        principalTable: "User",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Session",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    userId = table.Column<string>(type: "text", nullable: false),
                    token = table.Column<string>(type: "text", nullable: false),
                    expiresAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false),
                    ipAddress = table.Column<string>(type: "text", nullable: true),
                    userAgent = table.Column<string>(type: "text", nullable: true),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("Session_pkey", x => x.id);
                    table.ForeignKey(
                        name: "Session_userId_fkey",
                        column: x => x.userId,
                        principalTable: "User",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BcfComment",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    topicId = table.Column<string>(type: "text", nullable: false),
                    guid = table.Column<string>(type: "text", nullable: false),
                    comment = table.Column<string>(type: "text", nullable: false),
                    author = table.Column<string>(type: "text", nullable: false),
                    date = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false),
                    viewpointGuid = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("BcfComment_pkey", x => x.id);
                    table.ForeignKey(
                        name: "BcfComment_topicId_fkey",
                        column: x => x.topicId,
                        principalTable: "BcfTopic",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BcfTopicDevice",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    topicId = table.Column<string>(type: "text", nullable: false),
                    deviceId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("BcfTopicDevice_pkey", x => x.id);
                    table.ForeignKey(
                        name: "BcfTopicDevice_topicId_fkey",
                        column: x => x.topicId,
                        principalTable: "BcfTopic",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BcfViewpoint",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    topicId = table.Column<string>(type: "text", nullable: false),
                    guid = table.Column<string>(type: "text", nullable: false),
                    camera = table.Column<string>(type: "jsonb", nullable: false),
                    components = table.Column<string>(type: "jsonb", nullable: false),
                    clippingPlanes = table.Column<string>(type: "jsonb", nullable: false),
                    snapshotKey = table.Column<string>(type: "text", nullable: true),
                    isPrimary = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("BcfViewpoint_pkey", x => x.id);
                    table.ForeignKey(
                        name: "BcfViewpoint_topicId_fkey",
                        column: x => x.topicId,
                        principalTable: "BcfTopic",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "OidEntry",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    oidProfileId = table.Column<string>(type: "text", nullable: false),
                    oid = table.Column<string>(type: "text", nullable: false),
                    metric = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("OidEntry_pkey", x => x.id);
                    table.ForeignKey(
                        name: "OidEntry_oidProfileId_fkey",
                        column: x => x.oidProfileId,
                        principalTable: "OidProfile",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Network",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    userId = table.Column<string>(type: "text", nullable: true),
                    name = table.Column<string>(type: "text", nullable: false),
                    homeAddress = table.Column<string>(type: "text", nullable: true),
                    homeLatitude = table.Column<double>(type: "double precision", nullable: true),
                    homeLongitude = table.Column<double>(type: "double precision", nullable: true),
                    homePublicIp = table.Column<string>(type: "text", nullable: true),
                    isp = table.Column<string>(type: "text", nullable: true),
                    downMbps = table.Column<double>(type: "double precision", nullable: true),
                    upMbps = table.Column<double>(type: "double precision", nullable: true),
                    version = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    oidProfileId = table.Column<string>(type: "text", nullable: true),
                    snmpCredentialId = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("Network_pkey", x => x.id);
                    table.ForeignKey(
                        name: "Network_oidProfileId_fkey",
                        column: x => x.oidProfileId,
                        principalTable: "OidProfile",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "Network_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "Network_snmpCredentialId_fkey",
                        column: x => x.snmpCredentialId,
                        principalTable: "SnmpCredential",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "Network_userId_fkey",
                        column: x => x.userId,
                        principalTable: "User",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "MemberProperty",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    memberId = table.Column<string>(type: "text", nullable: false),
                    propertyId = table.Column<string>(type: "text", nullable: false),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("MemberProperty_pkey", x => x.id);
                    table.ForeignKey(
                        name: "MemberProperty_memberId_fkey",
                        column: x => x.memberId,
                        principalTable: "OrganizationMember",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "MemberProperty_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "MemberProperty_propertyId_fkey",
                        column: x => x.propertyId,
                        principalTable: "Property",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Team",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    name = table.Column<string>(type: "text", nullable: false),
                    creatorMemberId = table.Column<string>(type: "text", nullable: true),
                    version = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("Team_pkey", x => x.id);
                    table.ForeignKey(
                        name: "Team_creatorMemberId_fkey",
                        column: x => x.creatorMemberId,
                        principalTable: "OrganizationMember",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "Team_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Device",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    userId = table.Column<string>(type: "text", nullable: true),
                    name = table.Column<string>(type: "text", nullable: false),
                    category = table.Column<DeviceCategory>(type: "\"DeviceCategory\"", nullable: false),
                    mobility = table.Column<DeviceMobility>(type: "\"DeviceMobility\"", nullable: false, defaultValueSql: "'UNKNOWN'::\"DeviceMobility\""),
                    latitude = table.Column<double>(type: "double precision", nullable: true),
                    longitude = table.Column<double>(type: "double precision", nullable: true),
                    floor = table.Column<int>(type: "integer", nullable: true),
                    floorLabel = table.Column<string>(type: "text", nullable: true),
                    ipAddress = table.Column<string>(type: "text", nullable: true),
                    macAddress = table.Column<string>(type: "text", nullable: true),
                    notes = table.Column<string>(type: "text", nullable: true),
                    version = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false),
                    location = table.Column<Point>(type: "geometry(Point,4326)", nullable: true),
                    networkId = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    propertyId = table.Column<string>(type: "text", nullable: false),
                    roleCode = table.Column<string>(type: "text", nullable: true),
                    x = table.Column<double>(type: "double precision", nullable: true),
                    y = table.Column<double>(type: "double precision", nullable: true),
                    z = table.Column<double>(type: "double precision", nullable: true),
                    oidProfileId = table.Column<string>(type: "text", nullable: true),
                    snmpCredentialId = table.Column<string>(type: "text", nullable: true),
                    ifcGlobalId = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("Device_pkey", x => x.id);
                    table.ForeignKey(
                        name: "Device_networkId_fkey",
                        column: x => x.networkId,
                        principalTable: "Network",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "Device_oidProfileId_fkey",
                        column: x => x.oidProfileId,
                        principalTable: "OidProfile",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "Device_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "Device_propertyId_fkey",
                        column: x => x.propertyId,
                        principalTable: "Property",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "Device_snmpCredentialId_fkey",
                        column: x => x.snmpCredentialId,
                        principalTable: "SnmpCredential",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "Device_userId_fkey",
                        column: x => x.userId,
                        principalTable: "User",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "NetworkProperty",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    networkId = table.Column<string>(type: "text", nullable: false),
                    propertyId = table.Column<string>(type: "text", nullable: false),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("NetworkProperty_pkey", x => x.id);
                    table.ForeignKey(
                        name: "NetworkProperty_networkId_fkey",
                        column: x => x.networkId,
                        principalTable: "Network",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "NetworkProperty_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "NetworkProperty_propertyId_fkey",
                        column: x => x.propertyId,
                        principalTable: "Property",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "TeamMember",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    teamId = table.Column<string>(type: "text", nullable: false),
                    memberId = table.Column<string>(type: "text", nullable: false),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("TeamMember_pkey", x => x.id);
                    table.ForeignKey(
                        name: "TeamMember_memberId_fkey",
                        column: x => x.memberId,
                        principalTable: "OrganizationMember",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "TeamMember_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "TeamMember_teamId_fkey",
                        column: x => x.teamId,
                        principalTable: "Team",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TeamProperty",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    teamId = table.Column<string>(type: "text", nullable: false),
                    propertyId = table.Column<string>(type: "text", nullable: false),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("TeamProperty_pkey", x => x.id);
                    table.ForeignKey(
                        name: "TeamProperty_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "TeamProperty_propertyId_fkey",
                        column: x => x.propertyId,
                        principalTable: "Property",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "TeamProperty_teamId_fkey",
                        column: x => x.teamId,
                        principalTable: "Team",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Circuit",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    userId = table.Column<string>(type: "text", nullable: true),
                    ispName = table.Column<string>(type: "text", nullable: false),
                    circuitId = table.Column<string>(type: "text", nullable: true),
                    serviceType = table.Column<string>(type: "text", nullable: false),
                    bandwidth = table.Column<double>(type: "double precision", nullable: true),
                    deviceId = table.Column<string>(type: "text", nullable: true),
                    notes = table.Column<string>(type: "text", nullable: true),
                    version = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("Circuit_pkey", x => x.id);
                    table.ForeignKey(
                        name: "Circuit_deviceId_fkey",
                        column: x => x.deviceId,
                        principalTable: "Device",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "Circuit_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "Circuit_userId_fkey",
                        column: x => x.userId,
                        principalTable: "User",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "DeviceConnection",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    userId = table.Column<string>(type: "text", nullable: true),
                    sourceDeviceId = table.Column<string>(type: "text", nullable: false),
                    targetDeviceId = table.Column<string>(type: "text", nullable: false),
                    connectionType = table.Column<ConnectionType>(type: "\"ConnectionType\"", nullable: false),
                    notes = table.Column<string>(type: "text", nullable: true),
                    version = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("DeviceConnection_pkey", x => x.id);
                    table.ForeignKey(
                        name: "DeviceConnection_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "DeviceConnection_sourceDeviceId_fkey",
                        column: x => x.sourceDeviceId,
                        principalTable: "Device",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "DeviceConnection_targetDeviceId_fkey",
                        column: x => x.targetDeviceId,
                        principalTable: "Device",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "DeviceConnection_userId_fkey",
                        column: x => x.userId,
                        principalTable: "User",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "DeviceStatus",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    deviceId = table.Column<string>(type: "text", nullable: false),
                    state = table.Column<DeviceStatusState>(type: "\"DeviceStatusState\"", nullable: false, defaultValueSql: "'UNKNOWN'::\"DeviceStatusState\""),
                    latencyMs = table.Column<double>(type: "double precision", nullable: true),
                    consecutiveFails = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    lastCheckAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    lastOkAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    lastChangeAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    source = table.Column<string>(type: "text", nullable: true),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("DeviceStatus_pkey", x => x.id);
                    table.ForeignKey(
                        name: "DeviceStatus_deviceId_fkey",
                        column: x => x.deviceId,
                        principalTable: "Device",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "DeviceStatus_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "FiberRun",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    userId = table.Column<string>(type: "text", nullable: true),
                    name = table.Column<string>(type: "text", nullable: false),
                    startDeviceId = table.Column<string>(type: "text", nullable: false),
                    endDeviceId = table.Column<string>(type: "text", nullable: false),
                    cableType = table.Column<string>(type: "text", nullable: true),
                    lengthMeters = table.Column<double>(type: "double precision", nullable: true),
                    notes = table.Column<string>(type: "text", nullable: true),
                    version = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("FiberRun_pkey", x => x.id);
                    table.ForeignKey(
                        name: "FiberRun_endDeviceId_fkey",
                        column: x => x.endDeviceId,
                        principalTable: "Device",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FiberRun_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FiberRun_startDeviceId_fkey",
                        column: x => x.startDeviceId,
                        principalTable: "Device",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FiberRun_userId_fkey",
                        column: x => x.userId,
                        principalTable: "User",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "BuildingModel",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    propertyId = table.Column<string>(type: "text", nullable: false),
                    name = table.Column<string>(type: "text", nullable: false),
                    activeVersionId = table.Column<string>(type: "text", nullable: true),
                    version = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("BuildingModel_pkey", x => x.id);
                    table.ForeignKey(
                        name: "BuildingModel_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "BuildingModel_propertyId_fkey",
                        column: x => x.propertyId,
                        principalTable: "Property",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "BuildingModelVersion",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    buildingModelId = table.Column<string>(type: "text", nullable: false),
                    versionNumber = table.Column<int>(type: "integer", nullable: false),
                    storageKey = table.Column<string>(type: "text", nullable: false),
                    fileName = table.Column<string>(type: "text", nullable: false),
                    contentHash = table.Column<string>(type: "text", nullable: false),
                    sizeBytes = table.Column<int>(type: "integer", nullable: false),
                    units = table.Column<string>(type: "text", nullable: true),
                    uploadedByMemberId = table.Column<string>(type: "text", nullable: true),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("BuildingModelVersion_pkey", x => x.id);
                    table.ForeignKey(
                        name: "BuildingModelVersion_buildingModelId_fkey",
                        column: x => x.buildingModelId,
                        principalTable: "BuildingModel",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "BuildingModelVersion_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "Account_userId_idx",
                table: "Account",
                column: "userId");

            migrationBuilder.CreateIndex(
                name: "Agent_organizationId_idx",
                table: "Agent",
                column: "organizationId");

            migrationBuilder.CreateIndex(
                name: "Agent_tokenHash_key",
                table: "Agent",
                column: "tokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "AgentEnrollmentCode_codeHash_key",
                table: "AgentEnrollmentCode",
                column: "codeHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "AgentEnrollmentCode_organizationId_idx",
                table: "AgentEnrollmentCode",
                column: "organizationId");

            migrationBuilder.CreateIndex(
                name: "BcfComment_topicId_idx",
                table: "BcfComment",
                column: "topicId");

            migrationBuilder.CreateIndex(
                name: "BcfTopic_organizationId_guid_key",
                table: "BcfTopic",
                columns: new[] { "organizationId", "guid" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "BcfTopic_organizationId_propertyId_idx",
                table: "BcfTopic",
                columns: new[] { "organizationId", "propertyId" });

            migrationBuilder.CreateIndex(
                name: "BcfTopicDevice_deviceId_idx",
                table: "BcfTopicDevice",
                column: "deviceId");

            migrationBuilder.CreateIndex(
                name: "BcfTopicDevice_topicId_deviceId_key",
                table: "BcfTopicDevice",
                columns: new[] { "topicId", "deviceId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "BcfViewpoint_topicId_idx",
                table: "BcfViewpoint",
                column: "topicId");

            migrationBuilder.CreateIndex(
                name: "BuildingModel_activeVersionId_key",
                table: "BuildingModel",
                column: "activeVersionId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "BuildingModel_organizationId_idx",
                table: "BuildingModel",
                column: "organizationId");

            migrationBuilder.CreateIndex(
                name: "BuildingModel_propertyId_key",
                table: "BuildingModel",
                column: "propertyId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "BuildingModelVersion_buildingModelId_idx",
                table: "BuildingModelVersion",
                column: "buildingModelId");

            migrationBuilder.CreateIndex(
                name: "BuildingModelVersion_buildingModelId_versionNumber_key",
                table: "BuildingModelVersion",
                columns: new[] { "buildingModelId", "versionNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "BuildingModelVersion_organizationId_idx",
                table: "BuildingModelVersion",
                column: "organizationId");

            migrationBuilder.CreateIndex(
                name: "ChangeLog_organizationId_createdAt_idx",
                table: "ChangeLog",
                columns: new[] { "organizationId", "createdAt" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "ChangeLog_organizationId_entityType_entityId_idx",
                table: "ChangeLog",
                columns: new[] { "organizationId", "entityType", "entityId" });

            migrationBuilder.CreateIndex(
                name: "ChangeLog_requestId_idx",
                table: "ChangeLog",
                column: "requestId");

            migrationBuilder.CreateIndex(
                name: "Circuit_organizationId_deviceId_idx",
                table: "Circuit",
                columns: new[] { "organizationId", "deviceId" });

            migrationBuilder.CreateIndex(
                name: "Circuit_organizationId_idx",
                table: "Circuit",
                column: "organizationId");

            migrationBuilder.CreateIndex(
                name: "Device_ipAddress_idx",
                table: "Device",
                column: "ipAddress");

            migrationBuilder.CreateIndex(
                name: "device_location_idx",
                table: "Device",
                column: "location")
                .Annotation("Npgsql:IndexMethod", "gist");

            migrationBuilder.CreateIndex(
                name: "Device_organizationId_category_idx",
                table: "Device",
                columns: new[] { "organizationId", "category" });

            migrationBuilder.CreateIndex(
                name: "Device_organizationId_createdAt_idx",
                table: "Device",
                columns: new[] { "organizationId", "createdAt" });

            migrationBuilder.CreateIndex(
                name: "Device_organizationId_floor_idx",
                table: "Device",
                columns: new[] { "organizationId", "floor" });

            migrationBuilder.CreateIndex(
                name: "Device_organizationId_idx",
                table: "Device",
                column: "organizationId");

            migrationBuilder.CreateIndex(
                name: "Device_organizationId_ifcGlobalId_idx",
                table: "Device",
                columns: new[] { "organizationId", "ifcGlobalId" });

            migrationBuilder.CreateIndex(
                name: "Device_organizationId_networkId_idx",
                table: "Device",
                columns: new[] { "organizationId", "networkId" });

            migrationBuilder.CreateIndex(
                name: "Device_organizationId_propertyId_idx",
                table: "Device",
                columns: new[] { "organizationId", "propertyId" });

            migrationBuilder.CreateIndex(
                name: "DeviceConnection_organizationId_sourceDeviceId_idx",
                table: "DeviceConnection",
                columns: new[] { "organizationId", "sourceDeviceId" });

            migrationBuilder.CreateIndex(
                name: "DeviceConnection_organizationId_sourceDeviceId_targetDevice_key",
                table: "DeviceConnection",
                columns: new[] { "organizationId", "sourceDeviceId", "targetDeviceId", "connectionType" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "DeviceConnection_organizationId_targetDeviceId_idx",
                table: "DeviceConnection",
                columns: new[] { "organizationId", "targetDeviceId" });

            migrationBuilder.CreateIndex(
                name: "DeviceMetric_organizationId_deviceId_time_idx",
                table: "DeviceMetric",
                columns: new[] { "organizationId", "deviceId", "time" },
                descending: new[] { false, false, true });

            migrationBuilder.CreateIndex(
                name: "DeviceMetric_organizationId_sourceType_time_idx",
                table: "DeviceMetric",
                columns: new[] { "organizationId", "sourceType", "time" },
                descending: new[] { false, false, true });

            migrationBuilder.CreateIndex(
                name: "DeviceMetric_organizationId_time_idx",
                table: "DeviceMetric",
                columns: new[] { "organizationId", "time" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "DeviceMetric_organizationId_userId_time_idx",
                table: "DeviceMetric",
                columns: new[] { "organizationId", "userId", "time" },
                descending: new[] { false, false, true });

            migrationBuilder.CreateIndex(
                name: "DeviceMetric_time_idx",
                table: "DeviceMetric",
                column: "time",
                descending: new bool[0]);

            migrationBuilder.CreateIndex(
                name: "DeviceStatus_deviceId_key",
                table: "DeviceStatus",
                column: "deviceId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "DeviceStatus_organizationId_idx",
                table: "DeviceStatus",
                column: "organizationId");

            migrationBuilder.CreateIndex(
                name: "device_status_event_dev_time",
                table: "DeviceStatusEvent",
                columns: new[] { "deviceId", "time" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "DeviceStatusEvent_time_idx",
                table: "DeviceStatusEvent",
                column: "time",
                descending: new bool[0]);

            migrationBuilder.CreateIndex(
                name: "FiberRun_organizationId_endDeviceId_idx",
                table: "FiberRun",
                columns: new[] { "organizationId", "endDeviceId" });

            migrationBuilder.CreateIndex(
                name: "FiberRun_organizationId_idx",
                table: "FiberRun",
                column: "organizationId");

            migrationBuilder.CreateIndex(
                name: "FiberRun_organizationId_startDeviceId_idx",
                table: "FiberRun",
                columns: new[] { "organizationId", "startDeviceId" });

            migrationBuilder.CreateIndex(
                name: "Invitation_email_idx",
                table: "Invitation",
                column: "email");

            migrationBuilder.CreateIndex(
                name: "Invitation_organizationId_idx",
                table: "Invitation",
                column: "organizationId");

            migrationBuilder.CreateIndex(
                name: "Invitation_token_key",
                table: "Invitation",
                column: "token",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "JoinRequest_organizationId_status_idx",
                table: "JoinRequest",
                columns: new[] { "organizationId", "status" });

            migrationBuilder.CreateIndex(
                name: "JoinRequest_userId_idx",
                table: "JoinRequest",
                column: "userId");

            migrationBuilder.CreateIndex(
                name: "MemberProperty_memberId_propertyId_key",
                table: "MemberProperty",
                columns: new[] { "memberId", "propertyId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "MemberProperty_organizationId_idx",
                table: "MemberProperty",
                column: "organizationId");

            migrationBuilder.CreateIndex(
                name: "MemberProperty_propertyId_idx",
                table: "MemberProperty",
                column: "propertyId");

            migrationBuilder.CreateIndex(
                name: "MonitoringIngestToken_organizationId_key",
                table: "MonitoringIngestToken",
                column: "organizationId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "monitoring_metric_dev_metric_time",
                table: "MonitoringMetric",
                columns: new[] { "deviceId", "metric", "time" },
                descending: new[] { false, false, true });

            migrationBuilder.CreateIndex(
                name: "MonitoringMetric_time_idx",
                table: "MonitoringMetric",
                column: "time",
                descending: new bool[0]);

            migrationBuilder.CreateIndex(
                name: "Network_organizationId_idx",
                table: "Network",
                column: "organizationId");

            migrationBuilder.CreateIndex(
                name: "NetworkProperty_networkId_propertyId_key",
                table: "NetworkProperty",
                columns: new[] { "networkId", "propertyId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "NetworkProperty_organizationId_idx",
                table: "NetworkProperty",
                column: "organizationId");

            migrationBuilder.CreateIndex(
                name: "NetworkProperty_propertyId_idx",
                table: "NetworkProperty",
                column: "propertyId");

            migrationBuilder.CreateIndex(
                name: "OidEntry_oidProfileId_oid_key",
                table: "OidEntry",
                columns: new[] { "oidProfileId", "oid" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "OidProfile_organizationId_idx",
                table: "OidProfile",
                column: "organizationId");

            migrationBuilder.CreateIndex(
                name: "OrganizationDomain_domain_key",
                table: "OrganizationDomain",
                column: "domain",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "OrganizationDomain_organizationId_idx",
                table: "OrganizationDomain",
                column: "organizationId");

            migrationBuilder.CreateIndex(
                name: "OrganizationMember_organizationId_idx",
                table: "OrganizationMember",
                column: "organizationId");

            migrationBuilder.CreateIndex(
                name: "OrganizationMember_userId_key",
                table: "OrganizationMember",
                column: "userId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "Property_organizationId_idx",
                table: "Property",
                column: "organizationId");

            migrationBuilder.CreateIndex(
                name: "Property_organizationId_parentId_idx",
                table: "Property",
                columns: new[] { "organizationId", "parentId" });

            migrationBuilder.CreateIndex(
                name: "Property_organizationId_type_idx",
                table: "Property",
                columns: new[] { "organizationId", "type" });

            migrationBuilder.CreateIndex(
                name: "Session_token_idx",
                table: "Session",
                column: "token");

            migrationBuilder.CreateIndex(
                name: "Session_token_key",
                table: "Session",
                column: "token",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "Session_userId_idx",
                table: "Session",
                column: "userId");

            migrationBuilder.CreateIndex(
                name: "SnmpCredential_organizationId_idx",
                table: "SnmpCredential",
                column: "organizationId");

            migrationBuilder.CreateIndex(
                name: "Team_creatorMemberId_idx",
                table: "Team",
                column: "creatorMemberId");

            migrationBuilder.CreateIndex(
                name: "Team_organizationId_idx",
                table: "Team",
                column: "organizationId");

            migrationBuilder.CreateIndex(
                name: "TeamMember_memberId_idx",
                table: "TeamMember",
                column: "memberId");

            migrationBuilder.CreateIndex(
                name: "TeamMember_organizationId_idx",
                table: "TeamMember",
                column: "organizationId");

            migrationBuilder.CreateIndex(
                name: "TeamMember_teamId_memberId_key",
                table: "TeamMember",
                columns: new[] { "teamId", "memberId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "TeamProperty_organizationId_idx",
                table: "TeamProperty",
                column: "organizationId");

            migrationBuilder.CreateIndex(
                name: "TeamProperty_propertyId_idx",
                table: "TeamProperty",
                column: "propertyId");

            migrationBuilder.CreateIndex(
                name: "TeamProperty_teamId_propertyId_key",
                table: "TeamProperty",
                columns: new[] { "teamId", "propertyId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "User_email_key",
                table: "User",
                column: "email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "Verification_identifier_idx",
                table: "Verification",
                column: "identifier");

            migrationBuilder.AddForeignKey(
                name: "BuildingModel_activeVersionId_fkey",
                table: "BuildingModel",
                column: "activeVersionId",
                principalTable: "BuildingModelVersion",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            // --- Hand-authored DDL below: everything EF cannot express, lifted verbatim
            // --- from the Prisma migrations this Initial migration supersedes. The
            // --- MonitoringMetric_5m continuous aggregate is NOT here: caggs cannot be
            // --- created in a transaction, so MonitoringCaggInitializer owns it at boot.

            // Expression indexes (lower(name) uniques).
            migrationBuilder.Sql("""CREATE UNIQUE INDEX device_org_name_lower_uniq ON "Device" ("organizationId", lower(name));""");
            migrationBuilder.Sql("""CREATE UNIQUE INDEX property_parent_name_lower_uniq ON "Property" ("organizationId", "parentId", lower(name)) WHERE ("parentId" IS NOT NULL);""");
            migrationBuilder.Sql("""CREATE UNIQUE INDEX property_root_name_lower_uniq ON "Property" ("organizationId", lower(name)) WHERE ("parentId" IS NULL);""");
            migrationBuilder.Sql("""CREATE UNIQUE INDEX team_org_name_lower_uniq ON "Team" ("organizationId", lower(name));""");

            // Device.location is derived from latitude/longitude by trigger, so raw-SQL
            // writers and ORM writers can never disagree with the PostGIS point.
            migrationBuilder.Sql("""
                CREATE FUNCTION sync_device_location() RETURNS trigger
                    LANGUAGE plpgsql
                    AS $$
                BEGIN
                    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
                        NEW.location = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
                    ELSE
                        NEW.location = NULL;
                    END IF;
                    RETURN NEW;
                END;
                $$;
                """);
            migrationBuilder.Sql("""CREATE TRIGGER device_location_sync BEFORE INSERT OR UPDATE ON "Device" FOR EACH ROW EXECUTE FUNCTION sync_device_location();""");

            // TimescaleDB hypertables + compression + retention. MonitoringMetric's chunk
            // interval is 1 day from the start (the Prisma history created it at the 7-day
            // default and re-tuned it later; a fresh install goes straight to the end state).
            // create_default_indexes => FALSE everywhere: the "<table>_time_idx" indexes the
            // helper would create already exist (EF created them from the scaffolded model).
            migrationBuilder.Sql("""SELECT create_hypertable('"MonitoringMetric"', 'time', chunk_time_interval => INTERVAL '1 day', create_default_indexes => FALSE);""");
            migrationBuilder.Sql("""
                ALTER TABLE "MonitoringMetric" SET (
                  timescaledb.compress,
                  timescaledb.compress_segmentby = '"deviceId"',
                  timescaledb.compress_orderby = '"time" DESC'
                );
                """);
            migrationBuilder.Sql("""SELECT add_compression_policy('"MonitoringMetric"', INTERVAL '7 days');""");
            migrationBuilder.Sql("""SELECT add_retention_policy('"MonitoringMetric"', INTERVAL '90 days');""");

            migrationBuilder.Sql("""SELECT create_hypertable('"DeviceStatusEvent"', 'time', create_default_indexes => FALSE);""");
            migrationBuilder.Sql("""SELECT add_retention_policy('"DeviceStatusEvent"', INTERVAL '365 days');""");

            migrationBuilder.Sql("""SELECT create_hypertable('"DeviceMetric"', 'time', chunk_time_interval => INTERVAL '1 week', create_default_indexes => FALSE);""");
            migrationBuilder.Sql("""
                ALTER TABLE "DeviceMetric" SET (
                  timescaledb.compress,
                  timescaledb.compress_segmentby = '"userId"'
                );
                """);
            migrationBuilder.Sql("""SELECT add_compression_policy('"DeviceMetric"', INTERVAL '7 days');""");
            migrationBuilder.Sql("""SELECT add_retention_policy('"DeviceMetric"', INTERVAL '30 days');""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "BuildingModel_organizationId_fkey",
                table: "BuildingModel");

            migrationBuilder.DropForeignKey(
                name: "BuildingModelVersion_organizationId_fkey",
                table: "BuildingModelVersion");

            migrationBuilder.DropForeignKey(
                name: "Property_organizationId_fkey",
                table: "Property");

            migrationBuilder.DropForeignKey(
                name: "BuildingModel_activeVersionId_fkey",
                table: "BuildingModel");

            migrationBuilder.DropTable(
                name: "Account");

            migrationBuilder.DropTable(
                name: "Agent");

            migrationBuilder.DropTable(
                name: "AgentEnrollmentCode");

            migrationBuilder.DropTable(
                name: "BcfComment");

            migrationBuilder.DropTable(
                name: "BcfTopicDevice");

            migrationBuilder.DropTable(
                name: "BcfViewpoint");

            migrationBuilder.DropTable(
                name: "ChangeLog");

            migrationBuilder.DropTable(
                name: "Circuit");

            migrationBuilder.DropTable(
                name: "DeviceConnection");

            migrationBuilder.DropTable(
                name: "DeviceMetric");

            migrationBuilder.DropTable(
                name: "DeviceStatus");

            migrationBuilder.DropTable(
                name: "DeviceStatusEvent");

            migrationBuilder.DropTable(
                name: "FiberRun");

            migrationBuilder.DropTable(
                name: "Invitation");

            migrationBuilder.DropTable(
                name: "JoinRequest");

            migrationBuilder.DropTable(
                name: "MemberProperty");

            migrationBuilder.DropTable(
                name: "MonitoringIngestToken");

            migrationBuilder.DropTable(
                name: "MonitoringMetric");

            migrationBuilder.DropTable(
                name: "NetworkProperty");

            migrationBuilder.DropTable(
                name: "OidEntry");

            migrationBuilder.DropTable(
                name: "OrganizationDomain");

            migrationBuilder.DropTable(
                name: "Session");

            migrationBuilder.DropTable(
                name: "TeamMember");

            migrationBuilder.DropTable(
                name: "TeamProperty");

            migrationBuilder.DropTable(
                name: "Verification");

            migrationBuilder.DropTable(
                name: "BcfTopic");

            migrationBuilder.DropTable(
                name: "Device");

            migrationBuilder.DropTable(
                name: "Team");

            migrationBuilder.DropTable(
                name: "Network");

            migrationBuilder.DropTable(
                name: "OrganizationMember");

            migrationBuilder.DropTable(
                name: "OidProfile");

            migrationBuilder.DropTable(
                name: "SnmpCredential");

            migrationBuilder.DropTable(
                name: "User");

            migrationBuilder.DropTable(
                name: "Organization");

            migrationBuilder.DropTable(
                name: "BuildingModelVersion");

            migrationBuilder.DropTable(
                name: "BuildingModel");

            migrationBuilder.DropTable(
                name: "Property");
        }
    }
}
