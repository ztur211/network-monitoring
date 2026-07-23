using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Audit;
using NodeScope.Platform.Data;
using NodeScope.Platform.Http;

namespace NodeScope.Platform;

/// <summary>
/// Registration for the cross-cutting pieces every module relies on: the database location
/// (same <c>DATABASE_URL</c> the Node stack reads), a shared Npgsql data source for
/// non-EF access (audit), the audit service + per-request context, and org-context
/// authorization plumbing.
/// </summary>
public static class PlatformServices
{
    public static IServiceCollection AddNodeScopePlatform(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        var databaseUrl = configuration["NODESCOPE_DATABASE_URL"] ?? configuration["DATABASE_URL"]
            ?? throw new InvalidOperationException("DATABASE_URL is required");
        var connectionString = DatabaseUrl.ToConnectionString(databaseUrl);

        services.AddSingleton(new DatabaseConnectionString(connectionString));
        services.AddSingleton(_ => NpgsqlDataSource.Create(connectionString));

        services.AddScoped<AuditContext>();
        services.AddScoped<IAuditService, AuditService>();

        // Replaced by the Realtime module's implementation when it lands (TryAdd loses).
        services.TryAddSingleton<IRealtimeService, NoopRealtimeService>();

        services.AddScoped<OrgContextHolder>();
        services.AddScoped<IOrgContextAccessor>(sp => sp.GetRequiredService<OrgContextHolder>());
        services.AddSingleton<IAuthorizationHandler, OrgRequirementHandler>();
        services.AddAuthorization();

        return services;
    }

    /// <summary>
    /// Stamps the per-request audit context (the Node <c>AuditContextMiddleware</c>):
    /// request id, client ip, user-agent. The session handler adds the user id later.
    /// </summary>
    public static IApplicationBuilder UseAuditContext(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        return app.Use(static async (context, next) =>
        {
            var audit = context.RequestServices.GetRequiredService<AuditContext>();
            audit.RequestId = Guid.NewGuid().ToString();
            audit.IpAddress = context.Connection.RemoteIpAddress?.ToString();
            audit.UserAgent = context.Request.Headers.UserAgent.ToString() is { Length: > 0 } agent ? agent : null;
            await next(context);
        });
    }
}

/// <summary>The resolved Npgsql connection string, shared by every module's DbContext.</summary>
public sealed record DatabaseConnectionString(string Value);
