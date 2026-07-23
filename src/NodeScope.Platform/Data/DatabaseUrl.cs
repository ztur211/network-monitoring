using Npgsql;

namespace NodeScope.Platform.Data;

/// <summary>
/// Accepts the database location in either form the project uses: the libpq-style URL the
/// Node stack's <c>DATABASE_URL</c> carries (<c>postgresql://user:pass@host:port/db</c>) or
/// a native Npgsql key=value connection string. The C# stack must read the same env var the
/// Node stack does during the transition, so both processes point at the same database by
/// construction.
/// </summary>
public static class DatabaseUrl
{
    // The parameter is a string on purpose (not System.Uri, pace CA1054): it accepts either
    // a libpq URL or a native connection string, and only inspection tells which.
    public static string ToConnectionString(string configuredValue)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(configuredValue);

        if (!configuredValue.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase)
            && !configuredValue.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
        {
            return configuredValue;
        }

        var uri = new Uri(configuredValue);
        var userInfo = uri.UserInfo.Split(':', 2);
        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.IsDefaultPort ? 5432 : uri.Port,
            Database = uri.AbsolutePath.TrimStart('/'),
            Username = Uri.UnescapeDataString(userInfo[0]),
        };
        if (userInfo.Length > 1)
        {
            builder.Password = Uri.UnescapeDataString(userInfo[1]);
        }

        return builder.ConnectionString;
    }
}
