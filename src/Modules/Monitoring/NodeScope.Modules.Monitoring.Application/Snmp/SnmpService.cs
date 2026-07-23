using NodeScope.Contracts.Monitoring;
using NodeScope.Modules.Monitoring.Application.Agents;
using NodeScope.Modules.Monitoring.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Monitoring.Application.Snmp;

/// <summary>
/// SNMP credential/profile management + assignment + agent-target resolution, ported from
/// the Node <c>SnmpService</c>. Secrets are encrypted at rest and decrypted in exactly one
/// place (<see cref="AssembleTarget"/>) for the agent payload; every read DTO carries only
/// presence flags.
/// </summary>
public sealed class SnmpService
{
    private readonly ISnmpRepository _repo;
    private readonly ISecretCipher _cipher;
    private readonly IPermissionScopeService _scope;

    public SnmpService(ISnmpRepository repo, ISecretCipher cipher, IPermissionScopeService scope)
    {
        _repo = repo;
        _cipher = cipher;
        _scope = scope;
    }

    private static ApiException CredentialNotFound() => new("SNMP_001", "SNMP credential not found", 404);

    private static ApiException ProfileNotFound() => new("SNMP_002", "OID profile not found", 404);

    // ─── Credentials ─────────────────────────────────────────────────────────

    public async Task<SnmpCredentialDto> CreateCredentialAsync(
        string organizationId,
        CreateSnmpCredentialRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var row = await _repo.CreateCredentialAsync(
            new NewSnmpCredential(
                organizationId,
                request.Name!,
                SnmpLabels.ParseVersion(request.SnmpVersion!),
                request.SecurityLevel is null ? null : SnmpLabels.ParseSecurityLevel(request.SecurityLevel),
                request.SecurityName,
                request.AuthProtocol is null ? null : SnmpLabels.ParseAuthProtocol(request.AuthProtocol),
                request.PrivProtocol is null ? null : SnmpLabels.ParsePrivProtocol(request.PrivProtocol),
                request.Community is { Length: > 0 } community ? _cipher.Encrypt(community) : null,
                request.AuthKey is { Length: > 0 } authKey ? _cipher.Encrypt(authKey) : null,
                request.PrivKey is { Length: > 0 } privKey ? _cipher.Encrypt(privKey) : null),
            cancellationToken);
        return ToCredentialDto(row);
    }

    public async Task<SnmpCredentialDto> GetCredentialAsync(
        string organizationId,
        string id,
        CancellationToken cancellationToken) =>
        ToCredentialDto(
            await _repo.FindCredentialAsync(organizationId, id, cancellationToken) ?? throw CredentialNotFound());

    public async Task<IReadOnlyList<SnmpCredentialDto>> ListCredentialsAsync(
        string organizationId,
        CancellationToken cancellationToken) =>
        [.. (await _repo.ListCredentialsAsync(organizationId, cancellationToken)).Select(ToCredentialDto)];

    public async Task DeleteCredentialAsync(string organizationId, string id, CancellationToken cancellationToken)
    {
        _ = await _repo.FindCredentialAsync(organizationId, id, cancellationToken) ?? throw CredentialNotFound();
        if (await _repo.CountCredentialAssignmentsAsync(id, cancellationToken) > 0)
        {
            throw new ApiException(
                "SNMP_003",
                "Cannot delete a credential that is still assigned to networks or devices",
                409);
        }

        await _repo.DeleteCredentialAsync(id, cancellationToken);
    }

    // ─── Profiles ────────────────────────────────────────────────────────────

    public async Task<OidProfileDto> CreateProfileAsync(
        string organizationId,
        CreateOidProfileRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var row = await _repo.CreateProfileAsync(
            organizationId,
            request.Name!,
            request.IncludeInterfaceMetrics ?? false,
            [.. (request.Entries ?? []).Select(e => (e.Oid!, e.Metric!))],
            cancellationToken);
        return ToProfileDto(row);
    }

    public async Task<OidProfileDto> GetProfileAsync(
        string organizationId,
        string id,
        CancellationToken cancellationToken) =>
        ToProfileDto(await _repo.FindProfileAsync(organizationId, id, cancellationToken) ?? throw ProfileNotFound());

    public async Task<IReadOnlyList<OidProfileSummaryDto>> ListProfilesAsync(
        string organizationId,
        CancellationToken cancellationToken) =>
        [.. (await _repo.ListProfilesAsync(organizationId, cancellationToken)).Select(ToProfileSummaryDto)];

    public async Task DeleteProfileAsync(string organizationId, string id, CancellationToken cancellationToken)
    {
        _ = await _repo.FindProfileAsync(organizationId, id, cancellationToken) ?? throw ProfileNotFound();
        if (await _repo.CountProfileAssignmentsAsync(id, cancellationToken) > 0)
        {
            throw new ApiException(
                "SNMP_003",
                "Cannot delete a profile that is still assigned to networks or devices",
                409);
        }

        await _repo.DeleteProfileAsync(id, cancellationToken);
    }

    // ─── Assignment (F3-scoped) ──────────────────────────────────────────────

    /// <summary>
    /// Validation order is contract (SNMP_001 beats NETWORK_002/DEVICE_001): credential,
    /// then profile, then target. Device targets gate on the governing site
    /// (<c>PERM_001</c>); network targets need full charter+footprint coverage
    /// (<c>PERM_004</c>).
    /// </summary>
    public async Task<AssignResultDto> AssignAsync(
        OrgMemberContext member,
        string targetType,
        string targetId,
        string? snmpCredentialId,
        string? oidProfileId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var organizationId = member.OrganizationId;

        if (snmpCredentialId is not null
            && await _repo.FindCredentialAsync(organizationId, snmpCredentialId, cancellationToken) is null)
        {
            throw CredentialNotFound();
        }

        if (oidProfileId is not null
            && await _repo.FindProfileAsync(organizationId, oidProfileId, cancellationToken) is null)
        {
            throw ProfileNotFound();
        }

        if (targetType == "device")
        {
            var device = await _repo.FindOwnedDeviceAsync(organizationId, targetId, cancellationToken)
                ?? throw new ApiException("DEVICE_001", "DEVICE_NOT_FOUND", 404);
            await _scope.AssertCanConfigureAsync(member, device.PropertyId, cancellationToken);

            var (credentialId, profileId) = await _repo.SetDeviceAssignmentAsync(
                targetId, snmpCredentialId, oidProfileId, cancellationToken);
            return new AssignResultDto("device", targetId, credentialId, profileId);
        }

        if (!await _repo.NetworkExistsAsync(organizationId, targetId, cancellationToken))
        {
            throw new ApiException("NETWORK_002", "NETWORK_NOT_FOUND", 404);
        }

        var coverage = new HashSet<string>(StringComparer.Ordinal);
        coverage.UnionWith(await _repo.CharteredPropertyIdsAsync(organizationId, targetId, cancellationToken));
        coverage.UnionWith(await _repo.DeviceFootprintPropertyIdsAsync(organizationId, targetId, cancellationToken));
        await _scope.AssertNetworkFullCoverageAsync(member, coverage, cancellationToken);

        var (networkCredentialId, networkProfileId) = await _repo.SetNetworkAssignmentAsync(
            targetId, snmpCredentialId, oidProfileId, cancellationToken);
        return new AssignResultDto("network", targetId, networkCredentialId, networkProfileId);
    }

    // ─── Resolution for the agent device sync ────────────────────────────────

    /// <summary>
    /// Attaches the resolved SNMP target to each device: bounded round trips (chunked chain
    /// load, then the distinct credentials/profiles), override-wins per field, each distinct
    /// credential+profile pair decrypted ONCE. Org-scoped loads mean a dangling id can never
    /// leak another org's secret.
    /// </summary>
    public async Task<IReadOnlyList<AgentDeviceDto>> AttachTargetsAsync(
        string organizationId,
        IReadOnlyList<AgentDeviceRecord> devices,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(devices);
        if (devices.Count == 0)
        {
            return [];
        }

        var chains = await _repo.DevicesWithSnmpAsync(
            organizationId, [.. devices.Select(d => d.Id)], cancellationToken);
        var refByDevice = new Dictionary<string, (string CredId, string? ProfId)>(StringComparer.Ordinal);
        foreach (var chain in chains)
        {
            var credId = chain.SnmpCredentialId ?? chain.NetworkSnmpCredentialId;
            if (credId is not null)
            {
                refByDevice[chain.Id] = (credId, chain.OidProfileId ?? chain.NetworkOidProfileId);
            }
        }

        var credIds = refByDevice.Values.Select(r => r.CredId).ToHashSet(StringComparer.Ordinal);
        var profIds = refByDevice.Values
            .Where(r => r.ProfId is not null)
            .Select(r => r.ProfId!)
            .ToHashSet(StringComparer.Ordinal);

        var credById = (await _repo.FindCredentialsByIdsAsync(organizationId, credIds, cancellationToken))
            .ToDictionary(c => c.Id, StringComparer.Ordinal);
        var profById = (await _repo.FindProfilesByIdsAsync(organizationId, profIds, cancellationToken))
            .ToDictionary(p => p.Id, StringComparer.Ordinal);

        var targetCache = new Dictionary<string, SnmpTargetDto?>(StringComparer.Ordinal);
        SnmpTargetDto? TargetFor((string CredId, string? ProfId) reference)
        {
            var key = $"{reference.CredId}:{reference.ProfId}";
            if (!targetCache.TryGetValue(key, out var target))
            {
                target = credById.TryGetValue(reference.CredId, out var cred)
                    ? AssembleTarget(cred, reference.ProfId is not null && profById.TryGetValue(reference.ProfId, out var prof) ? prof : null)
                    : null;
                targetCache[key] = target;
            }

            return target;
        }

        return [.. devices.Select(d => new AgentDeviceDto
        {
            Id = d.Id,
            Name = d.Name,
            IpAddress = d.IpAddress,
            Snmp = refByDevice.TryGetValue(d.Id, out var reference) ? TargetFor(reference) : null,
        })];
    }

    /// <summary>The ONLY place encrypted secrets are decrypted. Never persisted, never logged.</summary>
    private SnmpTargetDto AssembleTarget(SnmpCredentialRecord cred, OidProfileRecord? profile) =>
        new()
        {
            Version = SnmpLabels.Of(cred.SnmpVersion),
            Community = cred.CommunityEnc is null ? null : _cipher.Decrypt(cred.CommunityEnc),
            SecurityName = cred.SecurityName,
            SecurityLevel = cred.SecurityLevel is null ? null : SnmpLabels.Of(cred.SecurityLevel.Value),
            AuthProtocol = cred.AuthProtocol is null ? null : SnmpLabels.Of(cred.AuthProtocol.Value),
            AuthKey = cred.AuthKeyEnc is null ? null : _cipher.Decrypt(cred.AuthKeyEnc),
            PrivProtocol = cred.PrivProtocol is null ? null : SnmpLabels.Of(cred.PrivProtocol.Value),
            PrivKey = cred.PrivKeyEnc is null ? null : _cipher.Decrypt(cred.PrivKeyEnc),
            Oids = [.. (profile?.Entries ?? []).Select(e => new SnmpOidEntry { Oid = e.Oid, Metric = e.Metric })],
            InterfaceMetrics = profile?.IncludeInterfaceMetrics ?? false,
        };

    private static SnmpCredentialDto ToCredentialDto(SnmpCredentialRecord r) =>
        new(
            r.Id,
            r.OrganizationId,
            r.Name,
            SnmpLabels.Of(r.SnmpVersion),
            r.SecurityLevel is null ? null : SnmpLabels.Of(r.SecurityLevel.Value),
            r.SecurityName,
            r.AuthProtocol is null ? null : SnmpLabels.Of(r.AuthProtocol.Value),
            r.PrivProtocol is null ? null : SnmpLabels.Of(r.PrivProtocol.Value),
            r.CommunityEnc is not null,
            r.AuthKeyEnc is not null,
            r.PrivKeyEnc is not null,
            r.Version,
            r.CreatedAt,
            r.UpdatedAt);

    private static OidProfileDto ToProfileDto(OidProfileRecord r) =>
        new(
            r.Id,
            r.OrganizationId,
            r.Name,
            r.IncludeInterfaceMetrics,
            [.. r.Entries.Select(e => new OidEntryDto(e.Id, e.Oid, e.Metric))],
            r.Version,
            r.CreatedAt,
            r.UpdatedAt);

    private static OidProfileSummaryDto ToProfileSummaryDto(OidProfileRecord r) =>
        new(r.Id, r.OrganizationId, r.Name, r.IncludeInterfaceMetrics, r.Version, r.CreatedAt, r.UpdatedAt);
}
