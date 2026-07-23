using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace NodeScope.Platform.Data;

/// <summary>
/// Model conventions matching the existing Prisma-created schema, which does not move
/// (Decision 5). Prisma stores UTC instants in <c>TIMESTAMP(3)</c> (without time zone)
/// columns and names columns in camelCase; these helpers keep every module context aligned
/// with that reality instead of Npgsql's timestamptz/PascalCase defaults.
/// </summary>
public static class NodeScopeEfConventions
{
    // Written values are UTC wall-time; Npgsql requires Kind=Unspecified for 'timestamp'
    // columns. Read values come back Unspecified and are really UTC, so stamp them as such.
    private static readonly ValueConverter<DateTime, DateTime> UtcTimestamp = new(
        v => DateTime.SpecifyKind(v, DateTimeKind.Unspecified),
        v => DateTime.SpecifyKind(v, DateTimeKind.Utc));

    /// <summary>
    /// Applies the schema's conventions to every mapped entity: camelCase column names
    /// (<c>OrganizationId</c> -&gt; <c>organizationId</c>) and UTC-normalized
    /// <c>timestamp(3)</c> mapping for <see cref="DateTime"/> properties. Call at the end of
    /// <c>OnModelCreating</c>, after entity configuration; explicitly configured column
    /// names are left untouched.
    /// </summary>
    public static void ApplyNodeScopeColumnConventions(this ModelBuilder modelBuilder)
    {
        ArgumentNullException.ThrowIfNull(modelBuilder);

        foreach (var entity in modelBuilder.Model.GetEntityTypes())
        {
            foreach (var property in entity.GetProperties())
            {
                if (property.GetColumnName() == property.Name && property.Name.Length > 0)
                {
                    property.SetColumnName(string.Create(
                        property.Name.Length,
                        property.Name,
                        static (span, name) =>
                        {
                            name.AsSpan().CopyTo(span);
                            span[0] = char.ToLowerInvariant(span[0]);
                        }));
                }

                if (property.ClrType == typeof(DateTime) || property.ClrType == typeof(DateTime?))
                {
                    property.SetValueConverter(UtcTimestamp);
                    property.SetColumnType("timestamp(3) without time zone");
                }
            }
        }
    }
}
