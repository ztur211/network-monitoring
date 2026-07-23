using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using NodeScope.Modules.Monitoring.Application.Ingest;

namespace NodeScope.Modules.Monitoring.Infrastructure.Persistence;

/// <summary>EF/SQL implementation of <see cref="IIngestTokenRepository"/>.</summary>
internal sealed class IngestTokenRepository : IIngestTokenRepository
{
    private readonly MonitoringDbContext _db;

    public IngestTokenRepository(MonitoringDbContext db)
    {
        _db = db;
    }

    public Task UpsertAsync(string organizationId, string tokenHash, CancellationToken cancellationToken)
    {
        var id = Guid.NewGuid().ToString();
        // Bare DateTime parameters are inferred as timestamptz; the column is timestamp(3).
        var now = new NpgsqlParameter(null, NpgsqlDbType.Timestamp)
        {
            Value = DateTime.SpecifyKind(DateTime.UtcNow, DateTimeKind.Unspecified),
        };
        return _db.Database.ExecuteSqlAsync(
            $"""
            INSERT INTO "MonitoringIngestToken" ("id", "organizationId", "tokenHash", "updatedAt")
            VALUES ({id}, {organizationId}, {tokenHash}, {now})
            ON CONFLICT ("organizationId")
            DO UPDATE SET "tokenHash" = EXCLUDED."tokenHash", "updatedAt" = EXCLUDED."updatedAt"
            """,
            cancellationToken);
    }

    public Task<string?> FindOrganizationByTokenHashAsync(string tokenHash, CancellationToken cancellationToken) =>
        _db.IngestTokens.AsNoTracking()
            .Where(t => t.TokenHash == tokenHash)
            .Select(t => (string?)t.OrganizationId)
            .FirstOrDefaultAsync(cancellationToken);
}
