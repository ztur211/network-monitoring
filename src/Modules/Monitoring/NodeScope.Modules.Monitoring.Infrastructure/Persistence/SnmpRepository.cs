using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Monitoring.Application.Ingest;
using NodeScope.Modules.Monitoring.Application.Snmp;

namespace NodeScope.Modules.Monitoring.Infrastructure.Persistence;

/// <summary>
/// EF implementation of <see cref="ISnmpRepository"/>. Batch loads are chunked at 1000 ids
/// (Postgres caps a statement at 65,535 bind parameters; a per-device query loop is the
/// pool-drain failure mode the Node repository documents).
/// </summary>
internal sealed class SnmpRepository : ISnmpRepository
{
    private const int IdChunk = 1_000;

    private readonly MonitoringDbContext _db;

    public SnmpRepository(MonitoringDbContext db)
    {
        _db = db;
    }

    public async Task<SnmpCredentialRecord> CreateCredentialAsync(
        NewSnmpCredential credential,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(credential);
        var now = DateTime.UtcNow;
        var row = new SnmpCredentialRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = credential.OrganizationId,
            Name = credential.Name,
            SnmpVersion = credential.SnmpVersion,
            SecurityLevel = credential.SecurityLevel,
            SecurityName = credential.SecurityName,
            AuthProtocol = credential.AuthProtocol,
            PrivProtocol = credential.PrivProtocol,
            CommunityEnc = credential.CommunityEnc,
            AuthKeyEnc = credential.AuthKeyEnc,
            PrivKeyEnc = credential.PrivKeyEnc,
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.SnmpCredentials.Add(row);
        await _db.SaveChangesAsync(cancellationToken);
        return ToCredentialRecord(row);
    }

    public async Task<SnmpCredentialRecord?> FindCredentialAsync(
        string organizationId,
        string id,
        CancellationToken cancellationToken)
    {
        var row = await _db.SnmpCredentials.AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == id && c.OrganizationId == organizationId, cancellationToken);
        return row is null ? null : ToCredentialRecord(row);
    }

    public async Task<IReadOnlyList<SnmpCredentialRecord>> ListCredentialsAsync(
        string organizationId,
        CancellationToken cancellationToken) =>
        [.. (await _db.SnmpCredentials.AsNoTracking()
            .Where(c => c.OrganizationId == organizationId)
            .OrderBy(c => c.Name)
            .ToListAsync(cancellationToken))
            .Select(ToCredentialRecord)];

    public Task DeleteCredentialAsync(string id, CancellationToken cancellationToken) =>
        _db.SnmpCredentials.Where(c => c.Id == id).ExecuteDeleteAsync(cancellationToken);

    public async Task<int> CountCredentialAssignmentsAsync(string id, CancellationToken cancellationToken) =>
        await _db.Networks.CountAsync(n => n.SnmpCredentialId == id, cancellationToken)
        + await _db.Devices.CountAsync(d => d.SnmpCredentialId == id, cancellationToken);

    public async Task<OidProfileRecord> CreateProfileAsync(
        string organizationId,
        string name,
        bool includeInterfaceMetrics,
        IReadOnlyList<(string Oid, string Metric)> entries,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(entries);
        var now = DateTime.UtcNow;
        var row = new OidProfileRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = organizationId,
            Name = name,
            IncludeInterfaceMetrics = includeInterfaceMetrics,
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        foreach (var (oid, metric) in entries)
        {
            row.Entries.Add(new OidEntryRow
            {
                Id = Guid.NewGuid().ToString(),
                OidProfileId = row.Id,
                Oid = oid,
                Metric = metric,
            });
        }

        _db.OidProfiles.Add(row);
        await _db.SaveChangesAsync(cancellationToken);
        return ToProfileRecord(row);
    }

    public async Task<OidProfileRecord?> FindProfileAsync(
        string organizationId,
        string id,
        CancellationToken cancellationToken)
    {
        var row = await _db.OidProfiles.AsNoTracking()
            .Include(p => p.Entries)
            .FirstOrDefaultAsync(p => p.Id == id && p.OrganizationId == organizationId, cancellationToken);
        return row is null ? null : ToProfileRecord(row);
    }

    public async Task<IReadOnlyList<OidProfileRecord>> ListProfilesAsync(
        string organizationId,
        CancellationToken cancellationToken) =>
        [.. (await _db.OidProfiles.AsNoTracking()
            .Where(p => p.OrganizationId == organizationId)
            .OrderBy(p => p.Name)
            .ToListAsync(cancellationToken))
            .Select(ToProfileRecord)];

    public Task DeleteProfileAsync(string id, CancellationToken cancellationToken) =>
        _db.OidProfiles.Where(p => p.Id == id).ExecuteDeleteAsync(cancellationToken);

    public async Task<int> CountProfileAssignmentsAsync(string id, CancellationToken cancellationToken) =>
        await _db.Networks.CountAsync(n => n.OidProfileId == id, cancellationToken)
        + await _db.Devices.CountAsync(d => d.OidProfileId == id, cancellationToken);

    public async Task<OwnedDevice?> FindOwnedDeviceAsync(
        string organizationId,
        string deviceId,
        CancellationToken cancellationToken) =>
        await _db.Devices.AsNoTracking()
            .Where(d => d.Id == deviceId && d.OrganizationId == organizationId)
            .Select(d => new OwnedDevice(d.Id, d.PropertyId))
            .FirstOrDefaultAsync(cancellationToken);

    public Task<bool> NetworkExistsAsync(string organizationId, string networkId, CancellationToken cancellationToken) =>
        _db.Networks.AsNoTracking()
            .AnyAsync(n => n.Id == networkId && n.OrganizationId == organizationId, cancellationToken);

    public async Task<IReadOnlyList<string>> CharteredPropertyIdsAsync(
        string organizationId,
        string networkId,
        CancellationToken cancellationToken) =>
        await _db.NetworkProperties.AsNoTracking()
            .Where(np => np.OrganizationId == organizationId && np.NetworkId == networkId)
            .Select(np => np.PropertyId)
            .Distinct()
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<string>> DeviceFootprintPropertyIdsAsync(
        string organizationId,
        string networkId,
        CancellationToken cancellationToken) =>
        await _db.Devices.AsNoTracking()
            .Where(d => d.OrganizationId == organizationId && d.NetworkId == networkId)
            .Select(d => d.PropertyId)
            .Distinct()
            .ToListAsync(cancellationToken);

    public async Task<(string? CredentialId, string? ProfileId)> SetDeviceAssignmentAsync(
        string deviceId,
        string? snmpCredentialId,
        string? oidProfileId,
        CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        await _db.Devices.Where(d => d.Id == deviceId).ExecuteUpdateAsync(
            set => set
                .SetProperty(d => d.SnmpCredentialId, snmpCredentialId)
                .SetProperty(d => d.OidProfileId, oidProfileId)
                .SetProperty(d => d.UpdatedAt, now),
            cancellationToken);
        return (snmpCredentialId, oidProfileId);
    }

    public async Task<(string? CredentialId, string? ProfileId)> SetNetworkAssignmentAsync(
        string networkId,
        string? snmpCredentialId,
        string? oidProfileId,
        CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        await _db.Networks.Where(n => n.Id == networkId).ExecuteUpdateAsync(
            set => set
                .SetProperty(n => n.SnmpCredentialId, snmpCredentialId)
                .SetProperty(n => n.OidProfileId, oidProfileId)
                .SetProperty(n => n.UpdatedAt, now),
            cancellationToken);
        return (snmpCredentialId, oidProfileId);
    }

    public async Task<IReadOnlyList<DeviceSnmpChain>> DevicesWithSnmpAsync(
        string organizationId,
        IReadOnlyCollection<string> deviceIds,
        CancellationToken cancellationToken) =>
        await ByIdChunksAsync(deviceIds, ids =>
            _db.Devices.AsNoTracking()
                .Where(d => d.OrganizationId == organizationId && ids.Contains(d.Id))
                .Join(
                    _db.Networks.AsNoTracking(),
                    d => d.NetworkId,
                    n => n.Id,
                    (d, n) => new DeviceSnmpChain(
                        d.Id, d.SnmpCredentialId, d.OidProfileId, n.SnmpCredentialId, n.OidProfileId))
                .ToListAsync(cancellationToken));

    public async Task<IReadOnlyList<SnmpCredentialRecord>> FindCredentialsByIdsAsync(
        string organizationId,
        IReadOnlyCollection<string> ids,
        CancellationToken cancellationToken) =>
        [.. (await ByIdChunksAsync(ids, chunk =>
            _db.SnmpCredentials.AsNoTracking()
                .Where(c => c.OrganizationId == organizationId && chunk.Contains(c.Id))
                .ToListAsync(cancellationToken)))
            .Select(ToCredentialRecord)];

    public async Task<IReadOnlyList<OidProfileRecord>> FindProfilesByIdsAsync(
        string organizationId,
        IReadOnlyCollection<string> ids,
        CancellationToken cancellationToken) =>
        [.. (await ByIdChunksAsync(ids, chunk =>
            _db.OidProfiles.AsNoTracking()
                .Include(p => p.Entries)
                .Where(p => p.OrganizationId == organizationId && chunk.Contains(p.Id))
                .ToListAsync(cancellationToken)))
            .Select(ToProfileRecord)];

    private static async Task<List<R>> ByIdChunksAsync<R>(
        IReadOnlyCollection<string> ids,
        Func<List<string>, Task<List<R>>> load)
    {
        var unique = ids.Distinct(StringComparer.Ordinal).ToList();
        var rows = new List<R>();
        for (var i = 0; i < unique.Count; i += IdChunk)
        {
            rows.AddRange(await load(unique.GetRange(i, Math.Min(IdChunk, unique.Count - i))));
        }

        return rows;
    }

    private static SnmpCredentialRecord ToCredentialRecord(SnmpCredentialRow row) =>
        new(
            row.Id,
            row.OrganizationId,
            row.Name,
            row.SnmpVersion,
            row.SecurityLevel,
            row.SecurityName,
            row.AuthProtocol,
            row.PrivProtocol,
            row.CommunityEnc,
            row.AuthKeyEnc,
            row.PrivKeyEnc,
            row.Version,
            row.CreatedAt,
            row.UpdatedAt);

    private static OidProfileRecord ToProfileRecord(OidProfileRow row) =>
        new(
            row.Id,
            row.OrganizationId,
            row.Name,
            row.IncludeInterfaceMetrics,
            [.. row.Entries.Select(e => new OidEntryRecord(e.Id, e.Oid, e.Metric))],
            row.Version,
            row.CreatedAt,
            row.UpdatedAt);
}
