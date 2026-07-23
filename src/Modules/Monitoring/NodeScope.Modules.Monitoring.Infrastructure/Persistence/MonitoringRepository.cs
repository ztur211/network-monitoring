using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using NodeScope.Modules.Monitoring.Application.Ingest;
using NodeScope.Modules.Monitoring.Domain;

namespace NodeScope.Modules.Monitoring.Infrastructure.Persistence;

/// <summary>
/// EF for <c>DeviceStatus</c>; raw parameterized SQL (array-<c>unnest</c> bulk inserts) for
/// the two hypertables, which are never EF-mapped. The batched status upsert replaces Node's
/// bounded-concurrency fan-out (STATUS_UPSERT_CONCURRENCY=8) with a single
/// <c>INSERT .. ON CONFLICT</c> statement carrying identical per-row semantics.
/// </summary>
internal sealed class MonitoringRepository : IMonitoringRepository
{
    private readonly MonitoringDbContext _db;

    public MonitoringRepository(MonitoringDbContext db)
    {
        _db = db;
    }

    public async Task<IReadOnlyList<OwnedDevice>> ListOwnedDevicesAsync(
        string organizationId,
        IReadOnlyCollection<string> deviceIds,
        CancellationToken cancellationToken) =>
        await _db.Devices.AsNoTracking()
            .Where(d => d.OrganizationId == organizationId && deviceIds.Contains(d.Id))
            .Select(d => new OwnedDevice(d.Id, d.PropertyId))
            .ToListAsync(cancellationToken);

    public async Task<DeviceStatusRecord?> GetStatusAsync(
        string organizationId,
        string deviceId,
        CancellationToken cancellationToken) =>
        ToRecord(await _db.DeviceStatuses.AsNoTracking()
            .FirstOrDefaultAsync(s => s.OrganizationId == organizationId && s.DeviceId == deviceId, cancellationToken));

    public async Task<IReadOnlyList<DeviceStatusRecord>> ListStatusAsync(
        string organizationId,
        IReadOnlyCollection<string> deviceIds,
        CancellationToken cancellationToken) =>
        [.. (await _db.DeviceStatuses.AsNoTracking()
            .Where(s => s.OrganizationId == organizationId && deviceIds.Contains(s.DeviceId))
            .ToListAsync(cancellationToken))
            .Select(s => ToRecord(s)!)];

    public async Task UpsertStatusBatchAsync(
        IReadOnlyList<StatusUpsert> upserts,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(upserts);
        if (upserts.Count == 0)
        {
            return;
        }

        // lastOkAt/lastChangeAt ride in as per-row nullable values: an insert only ever
        // happens with changed=true (no prior row means the state "changed" by definition),
        // so NULL in those columns can only reach the DO UPDATE branch, where COALESCE keeps
        // the existing value - reproducing Node's conditional update exactly.
        var now = DateTime.UtcNow;
        const string sql =
            """
            INSERT INTO "DeviceStatus"
              ("id", "organizationId", "deviceId", "state", "latencyMs", "consecutiveFails",
               "source", "lastCheckAt", "lastOkAt", "lastChangeAt", "updatedAt")
            SELECT t.id, t.org, t.dev, t.state::"DeviceStatusState", t.lat, t.fails,
                   t.src, @now, t.last_ok, t.last_change, @now
            FROM unnest(@ids, @orgs, @devs, @states, @lats, @fails, @srcs, @lastOks, @lastChanges)
                 AS t(id, org, dev, state, lat, fails, src, last_ok, last_change)
            ON CONFLICT ("deviceId") DO UPDATE SET
              "state" = EXCLUDED."state",
              "latencyMs" = EXCLUDED."latencyMs",
              "consecutiveFails" = EXCLUDED."consecutiveFails",
              "source" = EXCLUDED."source",
              "lastCheckAt" = EXCLUDED."lastCheckAt",
              "lastOkAt" = COALESCE(EXCLUDED."lastOkAt", "DeviceStatus"."lastOkAt"),
              "lastChangeAt" = COALESCE(EXCLUDED."lastChangeAt", "DeviceStatus"."lastChangeAt"),
              "updatedAt" = EXCLUDED."updatedAt"
            """;

        await _db.Database.ExecuteSqlRawAsync(
            sql,
            [
                new NpgsqlParameter("now", NpgsqlDbType.Timestamp) { Value = Unspecified(now) },
                TextArray("ids", upserts.Select(_ => Guid.NewGuid().ToString())),
                TextArray("orgs", upserts.Select(u => u.OrganizationId)),
                TextArray("devs", upserts.Select(u => u.DeviceId)),
                TextArray("states", upserts.Select(u => DeviceStatusStateLabel.Of(u.State))),
                new NpgsqlParameter("lats", NpgsqlDbType.Array | NpgsqlDbType.Double)
                {
                    Value = upserts.Select(u => (object?)u.LatencyMs ?? DBNull.Value).ToArray(),
                },
                new NpgsqlParameter("fails", NpgsqlDbType.Array | NpgsqlDbType.Integer)
                {
                    Value = upserts.Select(u => u.ConsecutiveFails).ToArray(),
                },
                TextArray("srcs", upserts.Select(u => u.Source)),
                new NpgsqlParameter("lastOks", NpgsqlDbType.Array | NpgsqlDbType.Timestamp)
                {
                    Value = upserts.Select(u => u.Ok ? (object)Unspecified(now) : DBNull.Value).ToArray(),
                },
                new NpgsqlParameter("lastChanges", NpgsqlDbType.Array | NpgsqlDbType.Timestamp)
                {
                    Value = upserts.Select(u => u.Changed ? (object)Unspecified(now) : DBNull.Value).ToArray(),
                },
            ],
            cancellationToken);
    }

    public async Task InsertMetricsAsync(IReadOnlyList<MetricRow> rows, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(rows);
        if (rows.Count == 0)
        {
            return;
        }

        var now = DateTime.UtcNow;
        const string sql =
            """
            INSERT INTO "MonitoringMetric" ("time", "organizationId", "deviceId", "metric", "value", "source")
            SELECT t.ts, t.org, t.dev, t.met, t.val, t.src
            FROM unnest(@times, @orgs, @devs, @mets, @vals, @srcs) AS t(ts, org, dev, met, val, src)
            """;

        await _db.Database.ExecuteSqlRawAsync(
            sql,
            [
                new NpgsqlParameter("times", NpgsqlDbType.Array | NpgsqlDbType.TimestampTz)
                {
                    Value = rows.Select(r => Utc(r.Ts ?? now)).ToArray(),
                },
                TextArray("orgs", rows.Select(r => r.OrganizationId)),
                TextArray("devs", rows.Select(r => r.DeviceId)),
                TextArray("mets", rows.Select(r => r.Metric)),
                new NpgsqlParameter("vals", NpgsqlDbType.Array | NpgsqlDbType.Double)
                {
                    Value = rows.Select(r => r.Value).ToArray(),
                },
                TextArray("srcs", rows.Select(r => r.Source)),
            ],
            cancellationToken);
    }

    public async Task InsertStatusEventsAsync(IReadOnlyList<StatusEventRow> rows, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(rows);
        if (rows.Count == 0)
        {
            return;
        }

        var now = DateTime.UtcNow;
        const string sql =
            """
            INSERT INTO "DeviceStatusEvent" ("time", "organizationId", "deviceId", "state", "source")
            SELECT t.ts, t.org, t.dev, t.state, t.src
            FROM unnest(@times, @orgs, @devs, @states, @srcs) AS t(ts, org, dev, state, src)
            """;

        await _db.Database.ExecuteSqlRawAsync(
            sql,
            [
                new NpgsqlParameter("times", NpgsqlDbType.Array | NpgsqlDbType.TimestampTz)
                {
                    Value = rows.Select(_ => Utc(now)).ToArray(),
                },
                TextArray("orgs", rows.Select(r => r.OrganizationId)),
                TextArray("devs", rows.Select(r => r.DeviceId)),
                TextArray("states", rows.Select(r => DeviceStatusStateLabel.Of(r.State))),
                TextArray("srcs", rows.Select(r => r.Source)),
            ],
            cancellationToken);
    }

    public async Task<OwnedDevice?> FindOwnedDeviceAsync(
        string organizationId,
        string deviceId,
        CancellationToken cancellationToken) =>
        await _db.Devices.AsNoTracking()
            .Where(d => d.Id == deviceId && d.OrganizationId == organizationId)
            .Select(d => new OwnedDevice(d.Id, d.PropertyId))
            .FirstOrDefaultAsync(cancellationToken);

    public async Task<IReadOnlyList<string>> ListDeviceIdsUnderPropertiesAsync(
        string organizationId,
        IReadOnlyCollection<string> propertyIds,
        CancellationToken cancellationToken) =>
        await _db.Devices.AsNoTracking()
            .Where(d => d.OrganizationId == organizationId && propertyIds.Contains(d.PropertyId))
            .OrderByDescending(d => d.CreatedAt)
            .Select(d => d.Id)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<string>> MetricNamesAsync(
        string organizationId,
        string deviceId,
        DateTime sinceUtc,
        CancellationToken cancellationToken) =>
        await _db.Database
            .SqlQuery<string>(
                $"""
                SELECT DISTINCT "metric" AS "Value" FROM "MonitoringMetric"
                WHERE "organizationId" = {organizationId} AND "deviceId" = {deviceId}
                  AND "time" >= {new NpgsqlParameter(null, NpgsqlDbType.TimestampTz) { Value = Utc(sinceUtc) }}
                ORDER BY "metric"
                """)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<Application.Reads.StatusEventDto>> RecentStatusEventsAsync(
        string organizationId,
        string deviceId,
        int limit,
        CancellationToken cancellationToken) =>
        [.. (await _db.Database
            .SqlQuery<StatusEventQueryRow>(
                $"""
                SELECT "time" AS "Time", "state" AS "State", "source" AS "Source"
                FROM "DeviceStatusEvent"
                WHERE "organizationId" = {organizationId} AND "deviceId" = {deviceId}
                ORDER BY "time" DESC LIMIT {limit}
                """)
            .ToListAsync(cancellationToken))
            .Select(r => new Application.Reads.StatusEventDto(Utc(r.Time), r.State, r.Source))];

    public async Task<IReadOnlyList<Application.Reads.MetricPointDto>> QueryMetricAsync(
        string organizationId,
        string deviceId,
        string metric,
        DateTime fromUtc,
        DateTime toUtc,
        string bucket,
        CancellationToken cancellationToken)
    {
        if (MetricBuckets.IsCaggEligible(fromUtc, toUtc, bucket))
        {
            try
            {
                return await QueryMetricSqlAsync(
                    organizationId, deviceId, metric, fromUtc, toUtc, bucket, fromCagg: true, cancellationToken);
            }
            catch (PostgresException)
            {
                // Aggregate absent or unreadable: for a grid-aligned window raw and cagg are
                // identical by construction, so the fallback cannot change the chart.
            }
        }

        return await QueryMetricSqlAsync(
            organizationId, deviceId, metric, fromUtc, toUtc, bucket, fromCagg: false, cancellationToken);
    }

    private async Task<IReadOnlyList<Application.Reads.MetricPointDto>> QueryMetricSqlAsync(
        string organizationId,
        string deviceId,
        string metric,
        DateTime fromUtc,
        DateTime toUtc,
        string bucket,
        bool fromCagg,
        CancellationToken cancellationToken)
    {
        var from = new NpgsqlParameter(null, NpgsqlDbType.TimestampTz) { Value = Utc(fromUtc) };
        var to = new NpgsqlParameter(null, NpgsqlDbType.TimestampTz) { Value = Utc(toUtc) };

        var query = fromCagg
            ? _db.Database.SqlQuery<MetricPointQueryRow>(
                $"""
                SELECT time_bucket({bucket}::interval, "bucket") AS "Bucket",
                       (sum("sum_value")::float / NULLIF(sum("sample_count"), 0)) AS "Avg"
                FROM "MonitoringMetric_5m"
                WHERE "organizationId" = {organizationId} AND "deviceId" = {deviceId} AND "metric" = {metric}
                  AND "bucket" >= {from} AND "bucket" <= {to}
                GROUP BY 1 ORDER BY 1
                """)
            : _db.Database.SqlQuery<MetricPointQueryRow>(
                $"""
                SELECT time_bucket({bucket}::interval, "time") AS "Bucket", avg("value")::float AS "Avg"
                FROM "MonitoringMetric"
                WHERE "organizationId" = {organizationId} AND "deviceId" = {deviceId} AND "metric" = {metric}
                  AND "time" >= {from} AND "time" <= {to}
                GROUP BY 1 ORDER BY 1
                """);

        return [.. (await query.ToListAsync(cancellationToken))
            .Select(r => new Application.Reads.MetricPointDto(Utc(r.Bucket), r.Avg))];
    }

    private sealed record StatusEventQueryRow(DateTime Time, string State, string? Source);

    private sealed record MetricPointQueryRow(DateTime Bucket, double Avg);

    private static NpgsqlParameter TextArray(string name, IEnumerable<string> values) =>
        new(name, NpgsqlDbType.Array | NpgsqlDbType.Text) { Value = values.ToArray() };

    private static DateTime Unspecified(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Unspecified);

    private static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);

    private static DeviceStatusRecord? ToRecord(DeviceStatusRow? row) =>
        row is null
            ? null
            : new DeviceStatusRecord(
                row.DeviceId,
                row.State,
                row.LatencyMs,
                row.ConsecutiveFails,
                row.LastCheckAt,
                row.LastOkAt,
                row.LastChangeAt,
                row.Source);
}
