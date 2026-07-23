using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Monitoring.Application.Agents;
using NodeScope.Modules.Monitoring.Domain;

namespace NodeScope.Modules.Monitoring.Infrastructure.Persistence;

/// <summary>EF implementation of <see cref="IAgentRepository"/> over the existing tables.</summary>
internal sealed class AgentRepository : IAgentRepository
{
    private readonly MonitoringDbContext _db;

    public AgentRepository(MonitoringDbContext db)
    {
        _db = db;
    }

    public async Task<AgentRecord?> FindByIdAsync(string id, CancellationToken cancellationToken) =>
        ToRecord(await _db.Agents.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == id, cancellationToken));

    public async Task<AgentRecord?> FindByTokenHashAsync(string tokenHash, CancellationToken cancellationToken) =>
        ToRecord(await _db.Agents.AsNoTracking()
            .FirstOrDefaultAsync(a => a.TokenHash == tokenHash, cancellationToken));

    public async Task<IReadOnlyList<AgentRecord>> ListByOrgAsync(
        string organizationId,
        CancellationToken cancellationToken) =>
        [.. (await _db.Agents.AsNoTracking()
            .Where(a => a.OrganizationId == organizationId)
            .OrderByDescending(a => a.CreatedAt)
            .ToListAsync(cancellationToken))
            .Select(a => ToRecord(a)!)];

    public Task TouchLastSeenAsync(string id, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        return _db.Agents.Where(a => a.Id == id).ExecuteUpdateAsync(
            set => set
                .SetProperty(a => a.LastSeenAt, now)
                .SetProperty(a => a.UpdatedAt, now),
            cancellationToken);
    }

    public Task SetStatusAsync(string id, AgentStatus status, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        return _db.Agents.Where(a => a.Id == id).ExecuteUpdateAsync(
            set => set
                .SetProperty(a => a.Status, status)
                .SetProperty(a => a.UpdatedAt, now),
            cancellationToken);
    }

    public Task SetVersionIfChangedAsync(string id, string version, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        return _db.Agents
            .Where(a => a.Id == id && (a.Version == null || a.Version != version))
            .ExecuteUpdateAsync(
                set => set
                    .SetProperty(a => a.Version, version)
                    .SetProperty(a => a.UpdatedAt, now),
                cancellationToken);
    }

    public Task DeleteAsync(string id, CancellationToken cancellationToken) =>
        _db.Agents.Where(a => a.Id == id).ExecuteDeleteAsync(cancellationToken);

    public async Task CreateEnrollmentCodeAsync(
        string organizationId,
        string codeHash,
        DateTime expiresAt,
        string? createdByMemberId,
        CancellationToken cancellationToken)
    {
        _db.AgentEnrollmentCodes.Add(new AgentEnrollmentCodeRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = organizationId,
            CodeHash = codeHash,
            ExpiresAt = expiresAt,
            CreatedByMemberId = createdByMemberId,
            CreatedAt = DateTime.UtcNow,
        });
        await _db.SaveChangesAsync(cancellationToken);
    }

    public async Task<string?> RedeemCodeAndCreateAgentAsync(
        string codeHash,
        string name,
        string platform,
        string version,
        string tokenHash,
        CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);

        var code = await _db.AgentEnrollmentCodes.AsNoTracking()
            .FirstOrDefaultAsync(
                c => c.CodeHash == codeHash && c.UsedAt == null && c.ExpiresAt > now,
                cancellationToken);
        if (code is null)
        {
            return null;
        }

        // Atomic claim: zero rows updated means a concurrent redeemer already won.
        var claimed = await _db.AgentEnrollmentCodes
            .Where(c => c.Id == code.Id && c.UsedAt == null)
            .ExecuteUpdateAsync(set => set.SetProperty(c => c.UsedAt, now), cancellationToken);
        if (claimed != 1)
        {
            return null;
        }

        var agent = new AgentRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = code.OrganizationId,
            Name = name,
            Platform = platform,
            Version = version,
            Status = AgentStatus.Approved,
            TokenHash = tokenHash,
            CreatedByMemberId = code.CreatedByMemberId,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.Agents.Add(agent);
        await _db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return agent.Id;
    }

    public async Task<IReadOnlyList<AgentDeviceRecord>> ListOrgDevicesWithIpAsync(
        string organizationId,
        CancellationToken cancellationToken) =>
        await _db.Devices.AsNoTracking()
            .Where(d => d.OrganizationId == organizationId && d.IpAddress != null)
            .Select(d => new AgentDeviceRecord(d.Id, d.Name, d.IpAddress!))
            .ToListAsync(cancellationToken);

    private static AgentRecord? ToRecord(AgentRow? row) =>
        row is null
            ? null
            : new AgentRecord(
                row.Id,
                row.OrganizationId,
                row.Name,
                row.Platform,
                row.Version,
                row.Status,
                row.LastSeenAt);
}
