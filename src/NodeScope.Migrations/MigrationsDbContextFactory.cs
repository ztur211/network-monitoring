using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using NodeScope.Migrations.Entities;
using Npgsql;

namespace NodeScope.Migrations;

/// <summary>
/// The one place that knows how to build options for <see cref="MigrationsDbContext"/>:
/// the Api's startup migrator and the dotnet-ef design-time tooling both come through
/// here, so the enum mappings and the NetTopologySuite plugin can never diverge.
/// </summary>
public static class MigrationsDbContextOptions
{
    public static DbContextOptions<MigrationsDbContext> Create(string connectionString) =>
        new DbContextOptionsBuilder<MigrationsDbContext>()
            .UseNpgsql(connectionString, npgsql => npgsql
                .UseNetTopologySuite()
                .MapEnum<AccountTier>("AccountTier", nameTranslator: ConstantCaseNameTranslator.Instance)
                .MapEnum<AgentStatus>("AgentStatus", nameTranslator: ConstantCaseNameTranslator.Instance)
                .MapEnum<ChangeAction>("ChangeAction", nameTranslator: ConstantCaseNameTranslator.Instance)
                .MapEnum<ConnectionType>("ConnectionType", nameTranslator: ConstantCaseNameTranslator.Instance)
                .MapEnum<DeviceCategory>("DeviceCategory", nameTranslator: ConstantCaseNameTranslator.Instance)
                .MapEnum<DeviceMobility>("DeviceMobility", nameTranslator: ConstantCaseNameTranslator.Instance)
                .MapEnum<DeviceStatusState>("DeviceStatusState", nameTranslator: ConstantCaseNameTranslator.Instance)
                .MapEnum<JoinRequestStatus>("JoinRequestStatus", nameTranslator: ConstantCaseNameTranslator.Instance)
                .MapEnum<OrgRole>("OrgRole", nameTranslator: ConstantCaseNameTranslator.Instance)
                .MapEnum<PropertyType>("PropertyType", nameTranslator: ConstantCaseNameTranslator.Instance)
                .MapEnum<SnmpAuthProtocol>("SnmpAuthProtocol", nameTranslator: ConstantCaseNameTranslator.Instance)
                .MapEnum<SnmpPrivProtocol>("SnmpPrivProtocol", nameTranslator: ConstantCaseNameTranslator.Instance)
                .MapEnum<SnmpSecurityLevel>("SnmpSecurityLevel", nameTranslator: ConstantCaseNameTranslator.Instance)
                .MapEnum<SnmpVersion>("SnmpVersion", nameTranslator: ConstantCaseNameTranslator.Instance)
                .MapEnum<AlertChannelType>("AlertChannelType", nameTranslator: ConstantCaseNameTranslator.Instance)
                .MapEnum<AlertTrigger>("AlertTrigger", nameTranslator: ConstantCaseNameTranslator.Instance)
                .MapEnum<AlertSeverity>("AlertSeverity", nameTranslator: ConstantCaseNameTranslator.Instance)
                .MapEnum<AlertEventKind>("AlertEventKind", nameTranslator: ConstantCaseNameTranslator.Instance)
                .MapEnum<AlertDeliveryStatus>("AlertDeliveryStatus", nameTranslator: ConstantCaseNameTranslator.Instance))
            .Options;
}

/// <summary>
/// PascalCase members to the schema's CONSTANT_CASE labels (AuthPriv -> AUTH_PRIV,
/// Sha256 -> SHA256). A private copy of the Platform translator: this project must stay
/// standalone so dotnet-ef can drive it without dragging in the runtime graph.
/// </summary>
internal sealed class ConstantCaseNameTranslator : INpgsqlNameTranslator
{
    public static ConstantCaseNameTranslator Instance { get; } = new();

    public string TranslateTypeName(string clrName) => clrName;

    public string TranslateMemberName(string clrName)
    {
        ArgumentNullException.ThrowIfNull(clrName);
        var result = new System.Text.StringBuilder(clrName.Length + 4);
        for (var i = 0; i < clrName.Length; i++)
        {
            if (i > 0 && char.IsUpper(clrName[i]) && char.IsLower(clrName[i - 1]))
            {
                result.Append('_');
            }

            result.Append(char.ToUpperInvariant(clrName[i]));
        }

        return result.ToString();
    }
}

/// <summary>
/// Design-time entry point for the dotnet-ef CLI (migrations add / database update).
/// Reads DATABASE_URL-style config from the environment, falling back to the local
/// test cluster so `dotnet ef migrations add` needs no setup.
/// </summary>
internal sealed class MigrationsDbContextFactory : IDesignTimeDbContextFactory<MigrationsDbContext>
{
    public MigrationsDbContext CreateDbContext(string[] args) =>
        new(MigrationsDbContextOptions.Create(
            Environment.GetEnvironmentVariable("NODESCOPE_EF_CONNECTION")
                ?? "Host=localhost;Port=5433;Database=nodescope_schema_ref;Username=nodescope;Password=localdevpassword"));
}
