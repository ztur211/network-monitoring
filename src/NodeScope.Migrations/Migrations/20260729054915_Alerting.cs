using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodeScope.Migrations.Entities;

#nullable disable

namespace NodeScope.Migrations.Migrations
{
    /// <inheritdoc />
    public partial class Alerting : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .Annotation("Npgsql:Enum:AccountTier", "PERSONAL_FREE,PERSONAL_PAID,MULTI_PROPERTY,ENTERPRISE")
                .Annotation("Npgsql:Enum:AgentStatus", "PENDING,APPROVED,REVOKED")
                .Annotation("Npgsql:Enum:AlertChannelType", "WEBHOOK,EMAIL,INAPP")
                .Annotation("Npgsql:Enum:AlertDeliveryStatus", "PENDING,FAILED,SENT,GAVE_UP")
                .Annotation("Npgsql:Enum:AlertEventKind", "FIRING,RESOLVED")
                .Annotation("Npgsql:Enum:AlertSeverity", "INFO,WARNING,CRITICAL")
                .Annotation("Npgsql:Enum:AlertTrigger", "STATE_TRANSITION,METRIC_THRESHOLD")
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
                .Annotation("Npgsql:PostgresExtension:timescaledb_toolkit", ",,")
                .OldAnnotation("Npgsql:Enum:AccountTier", "PERSONAL_FREE,PERSONAL_PAID,MULTI_PROPERTY,ENTERPRISE")
                .OldAnnotation("Npgsql:Enum:AgentStatus", "PENDING,APPROVED,REVOKED")
                .OldAnnotation("Npgsql:Enum:ChangeAction", "CREATE,UPDATE,DELETE")
                .OldAnnotation("Npgsql:Enum:ConnectionType", "ETHERNET,FIBER,WIFI,LOGICAL")
                .OldAnnotation("Npgsql:Enum:DeviceCategory", "RAD,ONT,DSLAM,ROUTER,MODEM,FIBER_MEDIA_CONVERTER,FIREWALL,SWITCH,ACCESS_POINT,WIFI_EXTENDER,WIRELESS_BRIDGE,SERVER_RACK,PATCH_PANEL,UPS,COMPUTER,PHONE,TABLET,PRINTER,IOT_DEVICE,CUSTOM")
                .OldAnnotation("Npgsql:Enum:DeviceMobility", "HOME_ONLY,ROAMS,UNKNOWN")
                .OldAnnotation("Npgsql:Enum:DeviceStatusState", "UP,DOWN,WARNING,UNKNOWN")
                .OldAnnotation("Npgsql:Enum:JoinRequestStatus", "PENDING,APPROVED,DENIED")
                .OldAnnotation("Npgsql:Enum:OrgRole", "OWNER,ADMIN,MEMBER")
                .OldAnnotation("Npgsql:Enum:PropertyType", "SITE,BUILDING,FLOOR,AREA")
                .OldAnnotation("Npgsql:Enum:SnmpAuthProtocol", "MD5,SHA,SHA256")
                .OldAnnotation("Npgsql:Enum:SnmpPrivProtocol", "DES,AES,AES256")
                .OldAnnotation("Npgsql:Enum:SnmpSecurityLevel", "NO_AUTH_NO_PRIV,AUTH_NO_PRIV,AUTH_PRIV")
                .OldAnnotation("Npgsql:Enum:SnmpVersion", "V2C,V3")
                .OldAnnotation("Npgsql:PostgresExtension:postgis", ",,")
                .OldAnnotation("Npgsql:PostgresExtension:timescaledb", ",,")
                .OldAnnotation("Npgsql:PostgresExtension:timescaledb_toolkit", ",,");

            migrationBuilder.CreateTable(
                name: "AlertChannel",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    type = table.Column<AlertChannelType>(type: "\"AlertChannelType\"", nullable: false),
                    name = table.Column<string>(type: "text", nullable: false),
                    enabled = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    config = table.Column<string>(type: "jsonb", nullable: false, defaultValueSql: "'{}'::jsonb"),
                    secretEnc = table.Column<string>(type: "text", nullable: true),
                    version = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("AlertChannel_pkey", x => x.id);
                    table.ForeignKey(
                        name: "AlertChannel_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "AlertRule",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    name = table.Column<string>(type: "text", nullable: false),
                    enabled = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    trigger = table.Column<AlertTrigger>(type: "\"AlertTrigger\"", nullable: false),
                    scope = table.Column<string>(type: "jsonb", nullable: false),
                    targetStates = table.Column<string[]>(type: "text[]", nullable: false, defaultValueSql: "ARRAY[]::text[]"),
                    metric = table.Column<string>(type: "text", nullable: true),
                    op = table.Column<string>(type: "text", nullable: true),
                    threshold = table.Column<double>(type: "double precision", nullable: true),
                    forSeconds = table.Column<int>(type: "integer", nullable: true),
                    severity = table.Column<AlertSeverity>(type: "\"AlertSeverity\"", nullable: false),
                    cooldownSeconds = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    notifyOnRecovery = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    version = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("AlertRule_pkey", x => x.id);
                    table.ForeignKey(
                        name: "AlertRule_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "AlertEvent",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    ruleId = table.Column<string>(type: "text", nullable: true),
                    ruleName = table.Column<string>(type: "text", nullable: false),
                    deviceId = table.Column<string>(type: "text", nullable: true),
                    kind = table.Column<AlertEventKind>(type: "\"AlertEventKind\"", nullable: false),
                    severity = table.Column<AlertSeverity>(type: "\"AlertSeverity\"", nullable: false),
                    detail = table.Column<string>(type: "jsonb", nullable: false),
                    dedupKey = table.Column<string>(type: "text", nullable: false),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("AlertEvent_pkey", x => x.id);
                    table.ForeignKey(
                        name: "AlertEvent_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "AlertEvent_ruleId_fkey",
                        column: x => x.ruleId,
                        principalTable: "AlertRule",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "AlertIncident",
                columns: table => new
                {
                    dedupKey = table.Column<string>(type: "text", nullable: false),
                    organizationId = table.Column<string>(type: "text", nullable: false),
                    ruleId = table.Column<string>(type: "text", nullable: false),
                    deviceId = table.Column<string>(type: "text", nullable: false),
                    isOpen = table.Column<bool>(type: "boolean", nullable: false),
                    lastFiredAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    lastResolvedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("AlertIncident_pkey", x => x.dedupKey);
                    table.ForeignKey(
                        name: "AlertIncident_organizationId_fkey",
                        column: x => x.organizationId,
                        principalTable: "Organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "AlertIncident_ruleId_fkey",
                        column: x => x.ruleId,
                        principalTable: "AlertRule",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "AlertRuleChannel",
                columns: table => new
                {
                    ruleId = table.Column<string>(type: "text", nullable: false),
                    channelId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("AlertRuleChannel_pkey", x => new { x.ruleId, x.channelId });
                    table.ForeignKey(
                        name: "AlertRuleChannel_channelId_fkey",
                        column: x => x.channelId,
                        principalTable: "AlertChannel",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "AlertRuleChannel_ruleId_fkey",
                        column: x => x.ruleId,
                        principalTable: "AlertRule",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "AlertDelivery",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    alertEventId = table.Column<string>(type: "text", nullable: false),
                    channelId = table.Column<string>(type: "text", nullable: true),
                    status = table.Column<AlertDeliveryStatus>(type: "\"AlertDeliveryStatus\"", nullable: false, defaultValue: AlertDeliveryStatus.Pending),
                    attempts = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    lastAttemptAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    nextAttemptAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false),
                    lastError = table.Column<string>(type: "text", nullable: true),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("AlertDelivery_pkey", x => x.id);
                    table.ForeignKey(
                        name: "AlertDelivery_alertEventId_fkey",
                        column: x => x.alertEventId,
                        principalTable: "AlertEvent",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "AlertDelivery_channelId_fkey",
                        column: x => x.channelId,
                        principalTable: "AlertChannel",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "AlertChannel_organizationId_idx",
                table: "AlertChannel",
                column: "organizationId");

            migrationBuilder.CreateIndex(
                name: "AlertChannel_organizationId_name_key",
                table: "AlertChannel",
                columns: new[] { "organizationId", "name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "AlertDelivery_alertEventId_channelId_key",
                table: "AlertDelivery",
                columns: new[] { "alertEventId", "channelId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "AlertDelivery_channelId_idx",
                table: "AlertDelivery",
                column: "channelId");

            migrationBuilder.CreateIndex(
                name: "AlertDelivery_status_nextAttemptAt_idx",
                table: "AlertDelivery",
                columns: new[] { "status", "nextAttemptAt" });

            migrationBuilder.CreateIndex(
                name: "AlertEvent_dedupKey_idx",
                table: "AlertEvent",
                column: "dedupKey");

            migrationBuilder.CreateIndex(
                name: "AlertEvent_organizationId_createdAt_idx",
                table: "AlertEvent",
                columns: new[] { "organizationId", "createdAt" });

            migrationBuilder.CreateIndex(
                name: "AlertIncident_organizationId_idx",
                table: "AlertIncident",
                column: "organizationId");

            migrationBuilder.CreateIndex(
                name: "AlertRule_enabled_trigger_idx",
                table: "AlertRule",
                columns: new[] { "enabled", "trigger" });

            migrationBuilder.CreateIndex(
                name: "AlertRule_organizationId_idx",
                table: "AlertRule",
                column: "organizationId");

            migrationBuilder.CreateIndex(
                name: "AlertRule_organizationId_name_key",
                table: "AlertRule",
                columns: new[] { "organizationId", "name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "AlertRuleChannel_channelId_idx",
                table: "AlertRuleChannel",
                column: "channelId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AlertDelivery");

            migrationBuilder.DropTable(
                name: "AlertIncident");

            migrationBuilder.DropTable(
                name: "AlertRuleChannel");

            migrationBuilder.DropTable(
                name: "AlertEvent");

            migrationBuilder.DropTable(
                name: "AlertChannel");

            migrationBuilder.DropTable(
                name: "AlertRule");

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
                .Annotation("Npgsql:PostgresExtension:timescaledb_toolkit", ",,")
                .OldAnnotation("Npgsql:Enum:AccountTier", "PERSONAL_FREE,PERSONAL_PAID,MULTI_PROPERTY,ENTERPRISE")
                .OldAnnotation("Npgsql:Enum:AgentStatus", "PENDING,APPROVED,REVOKED")
                .OldAnnotation("Npgsql:Enum:AlertChannelType", "WEBHOOK,EMAIL,INAPP")
                .OldAnnotation("Npgsql:Enum:AlertDeliveryStatus", "PENDING,FAILED,SENT,GAVE_UP")
                .OldAnnotation("Npgsql:Enum:AlertEventKind", "FIRING,RESOLVED")
                .OldAnnotation("Npgsql:Enum:AlertSeverity", "INFO,WARNING,CRITICAL")
                .OldAnnotation("Npgsql:Enum:AlertTrigger", "STATE_TRANSITION,METRIC_THRESHOLD")
                .OldAnnotation("Npgsql:Enum:ChangeAction", "CREATE,UPDATE,DELETE")
                .OldAnnotation("Npgsql:Enum:ConnectionType", "ETHERNET,FIBER,WIFI,LOGICAL")
                .OldAnnotation("Npgsql:Enum:DeviceCategory", "RAD,ONT,DSLAM,ROUTER,MODEM,FIBER_MEDIA_CONVERTER,FIREWALL,SWITCH,ACCESS_POINT,WIFI_EXTENDER,WIRELESS_BRIDGE,SERVER_RACK,PATCH_PANEL,UPS,COMPUTER,PHONE,TABLET,PRINTER,IOT_DEVICE,CUSTOM")
                .OldAnnotation("Npgsql:Enum:DeviceMobility", "HOME_ONLY,ROAMS,UNKNOWN")
                .OldAnnotation("Npgsql:Enum:DeviceStatusState", "UP,DOWN,WARNING,UNKNOWN")
                .OldAnnotation("Npgsql:Enum:JoinRequestStatus", "PENDING,APPROVED,DENIED")
                .OldAnnotation("Npgsql:Enum:OrgRole", "OWNER,ADMIN,MEMBER")
                .OldAnnotation("Npgsql:Enum:PropertyType", "SITE,BUILDING,FLOOR,AREA")
                .OldAnnotation("Npgsql:Enum:SnmpAuthProtocol", "MD5,SHA,SHA256")
                .OldAnnotation("Npgsql:Enum:SnmpPrivProtocol", "DES,AES,AES256")
                .OldAnnotation("Npgsql:Enum:SnmpSecurityLevel", "NO_AUTH_NO_PRIV,AUTH_NO_PRIV,AUTH_PRIV")
                .OldAnnotation("Npgsql:Enum:SnmpVersion", "V2C,V3")
                .OldAnnotation("Npgsql:PostgresExtension:postgis", ",,")
                .OldAnnotation("Npgsql:PostgresExtension:timescaledb", ",,")
                .OldAnnotation("Npgsql:PostgresExtension:timescaledb_toolkit", ",,");
        }
    }
}
