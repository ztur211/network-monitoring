using NodeScope.Platform;
using Npgsql;

namespace NodeScope.Modules.Alerting.Infrastructure.Workers;

/// <summary>
/// Holds a PostgreSQL session advisory lock for a complete scheduler cycle. A connection
/// loss releases the lock, so a healthy replica can take over without a stale lease.
/// </summary>
internal sealed class PostgresCycleLock
{
    private readonly DatabaseConnectionString _connectionString;

    public PostgresCycleLock(DatabaseConnectionString connectionString)
    {
        _connectionString = connectionString;
    }

    public async Task<bool> TryRunAsync(
        long key,
        Func<CancellationToken, Task> action,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(action);
        await using var connection = new NpgsqlConnection(_connectionString.Value);
        await connection.OpenAsync(cancellationToken);
        await using var acquire = new NpgsqlCommand("SELECT pg_try_advisory_lock($1)", connection);
        acquire.Parameters.AddWithValue(key);
        var acquired = (bool)(await acquire.ExecuteScalarAsync(cancellationToken) ?? false);
        if (!acquired)
        {
            return false;
        }

        try
        {
            await action(cancellationToken);
            return true;
        }
        finally
        {
            await using var release = new NpgsqlCommand("SELECT pg_advisory_unlock($1)", connection);
            release.Parameters.AddWithValue(key);
            _ = await release.ExecuteScalarAsync(CancellationToken.None);
        }
    }
}
