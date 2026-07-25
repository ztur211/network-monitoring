using System.Text.Json;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;
using Npgsql;

namespace NodeScope.Platform.Audit;

/// <summary>
/// Writes <c>ChangeLog</c> rows exactly as the Node <c>AuditService</c> +
/// <c>ChangeLogRepository</c> did: client-generated uuid ids, the request context from
/// <see cref="AuditContext"/>, <c>action</c> cast into the <c>ChangeAction</c> enum, and
/// snapshots serialized camelCase into the jsonb column.
/// </summary>
internal sealed class AuditService : IAuditService
{
    private static readonly JsonSerializerOptions SnapshotJson = CreateSnapshotOptions();

    private readonly NpgsqlDataSource _dataSource;
    private readonly AuditContext _context;

    public AuditService(NpgsqlDataSource dataSource, AuditContext context)
    {
        _dataSource = dataSource;
        _context = context;
    }

    private sealed record LogRow(string? Field, string? OldValue, string? NewValue);

    public Task RecordCreateAsync(
        string organizationId,
        string entityType,
        string entityId,
        object snapshot,
        CancellationToken cancellationToken) =>
        InsertAsync(
            organizationId,
            entityType,
            entityId,
            "CREATE",
            [new LogRow(null, null, null)],
            JsonSerializer.Serialize(snapshot, SnapshotJson),
            cancellationToken);

    public Task RecordUpdateAsync(
        string organizationId,
        string entityType,
        string entityId,
        IReadOnlyList<AuditFieldChange> changes,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(changes);
        return changes.Count == 0
            ? Task.CompletedTask
            : InsertAsync(
                organizationId,
                entityType,
                entityId,
                "UPDATE",
                [.. changes.Select(c => new LogRow(c.Field, c.OldValue, c.NewValue))],
                snapshotJson: null,
                cancellationToken);
    }

    public Task RecordDeleteAsync(
        string organizationId,
        string entityType,
        string entityId,
        object snapshot,
        CancellationToken cancellationToken) =>
        InsertAsync(
            organizationId,
            entityType,
            entityId,
            "DELETE",
            [new LogRow(null, null, null)],
            JsonSerializer.Serialize(snapshot, SnapshotJson),
            cancellationToken);

    private async Task InsertAsync(
        string organizationId,
        string entityType,
        string entityId,
        string action,
        IReadOnlyList<LogRow> rows,
        string? snapshotJson,
        CancellationToken cancellationToken)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);
        foreach (var row in rows)
        {
            await using var command = connection.CreateCommand();
            command.CommandText =
                """
                INSERT INTO "ChangeLog"
                  ("id", "organizationId", "userId", "requestId", "action", "entityType", "entityId",
                   "field", "oldValue", "newValue", "snapshot", "ipAddress", "userAgent")
                VALUES
                  ($1, $2, $3, $4, $5::"ChangeAction", $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
                """;
            command.Parameters.Add(new NpgsqlParameter { Value = Guid.NewGuid().ToString() });
            command.Parameters.Add(new NpgsqlParameter { Value = organizationId });
            command.Parameters.Add(new NpgsqlParameter { Value = (object?)_context.UserId ?? DBNull.Value });
            command.Parameters.Add(new NpgsqlParameter { Value = _context.RequestId });
            command.Parameters.Add(new NpgsqlParameter { Value = action });
            command.Parameters.Add(new NpgsqlParameter { Value = entityType });
            command.Parameters.Add(new NpgsqlParameter { Value = entityId });
            command.Parameters.Add(new NpgsqlParameter { Value = (object?)row.Field ?? DBNull.Value });
            command.Parameters.Add(new NpgsqlParameter { Value = (object?)row.OldValue ?? DBNull.Value });
            command.Parameters.Add(new NpgsqlParameter { Value = (object?)row.NewValue ?? DBNull.Value });
            command.Parameters.Add(new NpgsqlParameter { Value = (object?)snapshotJson ?? DBNull.Value });
            command.Parameters.Add(new NpgsqlParameter { Value = (object?)_context.IpAddress ?? DBNull.Value });
            command.Parameters.Add(new NpgsqlParameter { Value = (object?)_context.UserAgent ?? DBNull.Value });
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    private static JsonSerializerOptions CreateSnapshotOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(new JsDateTimeConverter());
        return options;
    }
}
