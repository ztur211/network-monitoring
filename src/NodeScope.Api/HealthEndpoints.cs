using System.Reflection;
using Npgsql;
using NodeScope.Platform;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Api;

/// <summary>
/// <c>GET /api/health</c>, ported from Node's <c>health.controller.ts</c>: always 200, with
/// degradation reported in the body's <c>status</c> fields rather than the HTTP status (the
/// dashboard polls this and a 5xx would look like the API itself is down). It lives in the
/// host because it reports on the host's infrastructure, not on any one module's domain.
/// <para>The <c>redis</c> block reports the disabled shape verbatim: Decision 8 removed Redis
/// from the single-node appliance, which is exactly the state Node reported as
/// <c>{enabled:false, mode:"in-memory", status:"disabled"}</c> - and "disabled" counts as
/// healthy, matching Node's overall-status rule. <c>ai</c> is the same hardcoded "ok" the
/// Node controller served (inference never was probed server-side, and Decision 9 moves it
/// to the desktop client).</para>
/// </summary>
internal static class HealthEndpoints
{
    private static readonly string Version = ResolveVersion();

    public static IEndpointRouteBuilder MapApiHealthEndpoint(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/health", GetAsync);
        return app;
    }

    private static async Task<IResult> GetAsync(DatabaseConnectionString db, CancellationToken cancellationToken)
    {
        var database = await CheckDatabaseAsync(db.Value, cancellationToken) ? "ok" : "degraded";
        return Results.Json(new HealthResponseBody(
            Status: database == "ok" ? "ok" : "degraded",
            Version: Version,
            Timestamp: IsoTimestamp.Now(),
            Services: new HealthServicesBody(
                Database: database,
                Redis: new HealthRedisBody(Enabled: false, Mode: "in-memory", ClusterMode: false, Status: "disabled"),
                Ai: "ok")));
    }

    private static async Task<bool> CheckDatabaseAsync(string connectionString, CancellationToken cancellationToken)
    {
        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(cancellationToken);
            await using var command = new NpgsqlCommand("SELECT 1", connection);
            await command.ExecuteScalarAsync(cancellationToken);
            return true;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // Any failure mode - refused, timeout, auth - is the same answer: degraded.
            return false;
        }
    }

    private static string ResolveVersion()
    {
        var informational = Assembly.GetExecutingAssembly()
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        if (string.IsNullOrEmpty(informational))
        {
            return "0.0.0-unknown";
        }

        // Strip build metadata (+hash) so the value stays semver-shaped like Node's.
        var metadata = informational.IndexOf('+', StringComparison.Ordinal);
        return metadata > 0 ? informational[..metadata] : informational;
    }
}

internal sealed record HealthResponseBody(
    string Status, string Version, string Timestamp, HealthServicesBody Services);

internal sealed record HealthServicesBody(string Database, HealthRedisBody Redis, string Ai);

internal sealed record HealthRedisBody(bool Enabled, string Mode, bool ClusterMode, string Status);
