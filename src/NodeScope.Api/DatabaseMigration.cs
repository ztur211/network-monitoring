using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using NodeScope.Migrations;
using NodeScope.Platform;

namespace NodeScope.Api;

/// <summary>
/// Startup migration (Decision 11/20): the host applies pending EF migrations before it
/// serves traffic, replacing the Node entrypoint's <c>prisma migrate deploy</c>. A database
/// created by the Prisma era is baselined on first contact - the Initial migration is
/// stamped as applied rather than re-run - after verifying the Prisma history is at the
/// final Node-era migration. Single-node appliance semantics: EF takes an advisory lock
/// during application, so even an accidental second instance cannot interleave.
/// </summary>
internal static partial class DatabaseMigration
{
    /// <summary>
    /// The last Prisma migration ever shipped (the Node stack is frozen at cutover). A
    /// Prisma-era database is only baselined when its history ends exactly here; anything
    /// older must first be brought current by the final Node image.
    /// </summary>
    private const string FinalPrismaMigration = "20260714123533_add_prober_and_live_metrics_indexes";

    public static async Task MigrateNodeScopeDatabaseAsync(this IServiceProvider services)
    {
        var connectionString = services.GetRequiredService<DatabaseConnectionString>().Value;
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("NodeScope.Api.DatabaseMigration");

        using var context = new MigrationsDbContext(MigrationsDbContextOptions.Create(connectionString));
        var history = context.GetService<IHistoryRepository>();

        // "No APPLIED migrations", not "no history table": design-time tooling can leave an
        // empty __EFMigrationsHistory behind, and an empty one still means Prisma built this
        // schema, not EF.
        var applied = await context.Database.GetAppliedMigrationsAsync().ConfigureAwait(false);
        if (!applied.Any() && await PrismaHistoryExistsAsync(context).ConfigureAwait(false))
        {
            await BaselinePrismaDatabaseAsync(context, history, logger).ConfigureAwait(false);
        }

        var pending = (await context.Database.GetPendingMigrationsAsync().ConfigureAwait(false)).ToList();
        if (pending.Count > 0 && logger.IsEnabled(LogLevel.Information))
        {
            var names = string.Join(", ", pending);
            LogApplying(logger, pending.Count, names);
        }

        await context.Database.MigrateAsync().ConfigureAwait(false);
        LogUpToDate(logger);
    }

    /// <summary>
    /// Stamps the Initial migration as applied: the schema already exists, built by the
    /// Prisma history this migration reproduces (verified by schema diff at the cutover).
    /// </summary>
    private static async Task BaselinePrismaDatabaseAsync(MigrationsDbContext context, IHistoryRepository history, ILogger logger)
    {
        var lastPrisma = await context.Database
            .SqlQueryRaw<string>(
                """SELECT migration_name AS "Value" FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1""")
            .SingleOrDefaultAsync()
            .ConfigureAwait(false);
        if (!string.Equals(lastPrisma, FinalPrismaMigration, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"This database's Prisma migration history ends at '{lastPrisma ?? "<none>"}' but the "
                + $"schema this host expects is '{FinalPrismaMigration}'. Run the final Node image once "
                + "(its entrypoint applies the remaining Prisma migrations), then start this host again.");
        }

        var initial = context.Database.GetMigrations().Order(StringComparer.Ordinal).First();
        var productVersion = typeof(DbContext).Assembly.GetName().Version!.ToString(3);
        await context.Database.ExecuteSqlRawAsync(history.GetCreateIfNotExistsScript()).ConfigureAwait(false);
        await context.Database.ExecuteSqlRawAsync(history.GetInsertScript(new HistoryRow(initial, productVersion))).ConfigureAwait(false);
        LogBaselined(logger, initial);
    }

    private static Task<bool> PrismaHistoryExistsAsync(MigrationsDbContext context) =>
        context.Database
            .SqlQueryRaw<bool>("""SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS "Value" """)
            .SingleAsync();

    [LoggerMessage(Level = LogLevel.Information,
        Message = "Prisma-era database detected: stamped {Migration} as applied (baseline, schema unchanged)")]
    private static partial void LogBaselined(ILogger logger, string migration);

    [LoggerMessage(Level = LogLevel.Information, Message = "Applying {Count} database migration(s): {Migrations}")]
    private static partial void LogApplying(ILogger logger, int count, string migrations);

    [LoggerMessage(Level = LogLevel.Information, Message = "Database schema is up to date")]
    private static partial void LogUpToDate(ILogger logger);
}
