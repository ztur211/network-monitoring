using NodeScope.Modules.Monitoring.Domain;

namespace NodeScope.Modules.Monitoring.Application.Agents;

/// <summary>An <c>Agent</c> row as the application layer sees it.</summary>
public sealed record AgentRecord(
    string Id,
    string OrganizationId,
    string Name,
    string? Platform,
    string? Version,
    AgentStatus Status,
    DateTime? LastSeenAt);

/// <summary>An IP-bearing device an agent can probe (id/name/address slice).</summary>
public sealed record AgentDeviceRecord(string Id, string Name, string IpAddress);

/// <summary>Persistence for the agent registry and enrollment codes.</summary>
public interface IAgentRepository
{
    public Task<AgentRecord?> FindByIdAsync(string id, CancellationToken cancellationToken);

    public Task<AgentRecord?> FindByTokenHashAsync(string tokenHash, CancellationToken cancellationToken);

    /// <summary>All agents of the org, newest first (<c>createdAt desc</c>).</summary>
    public Task<IReadOnlyList<AgentRecord>> ListByOrgAsync(string organizationId, CancellationToken cancellationToken);

    public Task TouchLastSeenAsync(string id, CancellationToken cancellationToken);

    public Task SetStatusAsync(string id, AgentStatus status, CancellationToken cancellationToken);

    /// <summary>Persists the heartbeat-reported agent version, writing only on change.</summary>
    public Task SetVersionIfChangedAsync(string id, string version, CancellationToken cancellationToken);

    public Task DeleteAsync(string id, CancellationToken cancellationToken);

    public Task CreateEnrollmentCodeAsync(
        string organizationId,
        string codeHash,
        DateTime expiresAt,
        string? createdByMemberId,
        CancellationToken cancellationToken);

    /// <summary>
    /// Atomically claims a valid (unused, unexpired) code and creates the agent, in one
    /// transaction - only one concurrent redeemer can win. Null when the code is invalid,
    /// expired, or already claimed (the caller cannot tell which, by design).
    /// </summary>
    public Task<string?> RedeemCodeAndCreateAgentAsync(
        string codeHash,
        string name,
        string platform,
        string version,
        string tokenHash,
        CancellationToken cancellationToken);

    /// <summary>The org's devices that carry an IP address - the set an agent can probe.</summary>
    public Task<IReadOnlyList<AgentDeviceRecord>> ListOrgDevicesWithIpAsync(
        string organizationId,
        CancellationToken cancellationToken);
}
