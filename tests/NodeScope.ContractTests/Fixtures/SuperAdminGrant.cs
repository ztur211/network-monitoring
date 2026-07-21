using Npgsql;

namespace NodeScope.ContractTests.Fixtures;

/// <summary>
/// The single, deliberate exception to this suite's black-box rule: granting
/// super-admin over a direct database connection.
/// <para>
/// Org bootstrap is a super-admin operation and there is no self-service "create
/// org" endpoint, so the whole Inventory/Monitoring surface needs a super-admin to
/// mint isolated per-test orgs. But <c>isSuperAdmin</c> is <c>input: false</c> in
/// <c>better-auth.config.ts</c> - it is not settable through any HTTP request, by
/// design. So exactly one arrange step cannot go over the wire, and this type owns
/// it: a lone parameterized <c>UPDATE "User" SET "isSuperAdmin" = true</c>. Every
/// other arrange path in the suite stays black-box HTTP. Keep it that way - this is
/// not a foothold for talking to the database in general.
/// </para>
/// </summary>
internal static class SuperAdminGrant
{
    /// <summary>
    /// Connection to the database the API under test is using. A libpq-style URL
    /// (<c>postgresql://user:pass@host:port/db</c>, the form the seed and target
    /// scripts already use) or a native Npgsql key=value string; both are accepted.
    /// </summary>
    public const string DatabaseUrlVariable = "NODESCOPE_DATABASE_URL";

    // The throwaway contract-test database (docker-compose.test.yml, host port 5433).
    private const string DefaultDatabaseUrl =
        "postgresql://nodescope:localdevpassword@localhost:5433/nodescope_test";

    /// <summary>
    /// Promotes an existing user to super-admin. The user must already have been
    /// created over HTTP (sign-up), so this only ever flips a flag on a row the
    /// suite itself just made.
    /// </summary>
    public static async Task GrantAsync(string email, CancellationToken cancellationToken = default)
    {
        await using var connection = new NpgsqlConnection(ResolveConnectionString());
        await connection.OpenAsync(cancellationToken);

        await using var command = new NpgsqlCommand(
            "UPDATE \"User\" SET \"isSuperAdmin\" = true WHERE email = @email",
            connection);
        command.Parameters.AddWithValue("email", email);

        var affected = await command.ExecuteNonQueryAsync(cancellationToken);
        if (affected == 0)
        {
            throw new InvalidOperationException(
                $"Could not grant super-admin: no \"User\" row with email '{email}'. The user must be " +
                $"signed up over HTTP first, and {DatabaseUrlVariable} must name the same database the API " +
                $"under test writes to (default: the contract-test DB on 5433).");
        }
    }

    /// <summary>
    /// Turns <see cref="DatabaseUrlVariable"/> into an Npgsql connection string,
    /// accepting either a <c>postgres(ql)://</c> URL or a native key=value string.
    /// </summary>
    private static string ResolveConnectionString()
    {
        var configured = Environment.GetEnvironmentVariable(DatabaseUrlVariable);
        var value = string.IsNullOrWhiteSpace(configured) ? DefaultDatabaseUrl : configured.Trim();

        var isUrl = value.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase)
            || value.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase);
        if (!isUrl)
        {
            return value;
        }

        var uri = new Uri(value);
        var userInfo = uri.UserInfo.Split(':', 2);
        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.Port > 0 ? uri.Port : 5432,
            Username = Uri.UnescapeDataString(userInfo[0]),
            Password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : null,
            Database = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/')),
        };
        return builder.ConnectionString;
    }
}
