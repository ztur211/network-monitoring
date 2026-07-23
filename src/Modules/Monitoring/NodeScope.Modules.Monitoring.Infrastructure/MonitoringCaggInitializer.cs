using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace NodeScope.Modules.Monitoring.Infrastructure;

/// <summary>
/// Creates the 5-minute continuous aggregate over <c>MonitoringMetric</c> (+ refresh policy)
/// idempotently at startup, ported from <c>monitoring-cagg.service.ts</c>. Continuous
/// aggregates cannot be created inside a transaction, so this runs as autocommit DDL at boot
/// rather than in a migration. Failure is non-fatal: the metric query falls back to raw.
/// Implements <see cref="IHostedService"/> directly (Decision 6: no BackgroundService base).
/// </summary>
internal sealed partial class MonitoringCaggInitializer : IHostedService
{
    private readonly NpgsqlDataSource _dataSource;
    private readonly ILogger<MonitoringCaggInitializer> _logger;

    public MonitoringCaggInitializer(NpgsqlDataSource dataSource, ILogger<MonitoringCaggInitializer> logger)
    {
        _dataSource = dataSource;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);
            await using (var create = connection.CreateCommand())
            {
                // materialized_only=false enables real-time aggregation: rows newer than the
                // last refresh are unioned from the raw hypertable, so charts include the
                // latest data immediately.
                create.CommandText =
                    """
                    CREATE MATERIALIZED VIEW IF NOT EXISTS "MonitoringMetric_5m"
                    WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
                    SELECT time_bucket('5 minutes', "time") AS bucket,
                           "organizationId", "deviceId", "metric",
                           sum("value") AS sum_value, count(*) AS sample_count
                    FROM "MonitoringMetric"
                    GROUP BY 1, 2, 3, 4
                    WITH NO DATA
                    """;
                await create.ExecuteNonQueryAsync(cancellationToken);
            }

            await using (var policy = connection.CreateCommand())
            {
                policy.CommandText =
                    """
                    SELECT add_continuous_aggregate_policy('"MonitoringMetric_5m"',
                      start_offset => INTERVAL '1 day', end_offset => INTERVAL '5 minutes',
                      schedule_interval => INTERVAL '5 minutes', if_not_exists => TRUE)
                    """;
                await policy.ExecuteNonQueryAsync(cancellationToken);
            }

            Log.Ready(_logger);
        }
        catch (NpgsqlException exception)
        {
            Log.SetupFailed(_logger, exception);
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private static partial class Log
    {
        [LoggerMessage(Level = LogLevel.Information, Message = "MonitoringMetric_5m continuous aggregate ready")]
        public static partial void Ready(ILogger logger);

        [LoggerMessage(
            Level = LogLevel.Warning,
            Message = "Failed to set up MonitoringMetric continuous aggregate - charts use raw")]
        public static partial void SetupFailed(ILogger logger, Exception exception);
    }
}
