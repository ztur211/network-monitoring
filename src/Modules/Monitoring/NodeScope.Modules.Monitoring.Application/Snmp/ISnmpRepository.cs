namespace NodeScope.Modules.Monitoring.Application.Snmp;

/// <summary>
/// Persistence for SNMP credentials/profiles and the assignment columns they hang off
/// (which live on Inventory's <c>Device</c>/<c>Network</c> rows but are Monitoring-owned
/// data, exactly as the Node snmp module wrote them directly).
/// </summary>
public interface ISnmpRepository
{
    public Task<SnmpCredentialRecord> CreateCredentialAsync(NewSnmpCredential credential, CancellationToken cancellationToken);

    public Task<SnmpCredentialRecord?> FindCredentialAsync(string organizationId, string id, CancellationToken cancellationToken);

    public Task<IReadOnlyList<SnmpCredentialRecord>> ListCredentialsAsync(string organizationId, CancellationToken cancellationToken);

    public Task DeleteCredentialAsync(string id, CancellationToken cancellationToken);

    /// <summary>Networks + devices still referencing the credential (assignment guard).</summary>
    public Task<int> CountCredentialAssignmentsAsync(string id, CancellationToken cancellationToken);

    public Task<OidProfileRecord> CreateProfileAsync(
        string organizationId,
        string name,
        bool includeInterfaceMetrics,
        IReadOnlyList<(string Oid, string Metric)> entries,
        CancellationToken cancellationToken);

    public Task<OidProfileRecord?> FindProfileAsync(string organizationId, string id, CancellationToken cancellationToken);

    public Task<IReadOnlyList<OidProfileRecord>> ListProfilesAsync(string organizationId, CancellationToken cancellationToken);

    public Task DeleteProfileAsync(string id, CancellationToken cancellationToken);

    public Task<int> CountProfileAssignmentsAsync(string id, CancellationToken cancellationToken);

    /// <summary>The device + its property for the assign write path, or null when foreign/unknown.</summary>
    public Task<Ingest.OwnedDevice?> FindOwnedDeviceAsync(string organizationId, string deviceId, CancellationToken cancellationToken);

    public Task<bool> NetworkExistsAsync(string organizationId, string networkId, CancellationToken cancellationToken);

    /// <summary>Distinct chartered property ids of a network (<c>NetworkProperty</c>).</summary>
    public Task<IReadOnlyList<string>> CharteredPropertyIdsAsync(string organizationId, string networkId, CancellationToken cancellationToken);

    /// <summary>Distinct property ids of the network's devices (the footprint).</summary>
    public Task<IReadOnlyList<string>> DeviceFootprintPropertyIdsAsync(string organizationId, string networkId, CancellationToken cancellationToken);

    /// <summary>Sets both assignment columns on a device (null clears) and returns the stored pair.</summary>
    public Task<(string? CredentialId, string? ProfileId)> SetDeviceAssignmentAsync(
        string deviceId,
        string? snmpCredentialId,
        string? oidProfileId,
        CancellationToken cancellationToken);

    /// <summary>Sets both assignment columns on a network (null clears) and returns the stored pair.</summary>
    public Task<(string? CredentialId, string? ProfileId)> SetNetworkAssignmentAsync(
        string networkId,
        string? snmpCredentialId,
        string? oidProfileId,
        CancellationToken cancellationToken);

    /// <summary>Batch assignment chains for the agent device-sync path (chunked, org-scoped).</summary>
    public Task<IReadOnlyList<DeviceSnmpChain>> DevicesWithSnmpAsync(
        string organizationId,
        IReadOnlyCollection<string> deviceIds,
        CancellationToken cancellationToken);

    public Task<IReadOnlyList<SnmpCredentialRecord>> FindCredentialsByIdsAsync(
        string organizationId,
        IReadOnlyCollection<string> ids,
        CancellationToken cancellationToken);

    public Task<IReadOnlyList<OidProfileRecord>> FindProfilesByIdsAsync(
        string organizationId,
        IReadOnlyCollection<string> ids,
        CancellationToken cancellationToken);
}
