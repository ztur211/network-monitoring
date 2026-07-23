using NodeScope.Modules.Monitoring.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Monitoring.Application.Agents;

/// <summary>The agents-list wire DTO: <c>{ id, name, platform, version, status, lastSeenAt }</c>.</summary>
public sealed record AgentDto(
    string Id,
    string Name,
    string? Platform,
    string? Version,
    string Status,
    DateTime? LastSeenAt);

/// <summary>A bare <c>{ id }</c> response body.</summary>
public sealed record IdResult(string Id);

/// <summary>
/// OWNER/ADMIN management of the agent registry, ported from the Node <c>AgentsService</c>.
/// Every mutation asserts org ownership first, so an owner of org A touching org B's agent
/// sees the same <c>AGENT_002</c> as a nonexistent id.
/// </summary>
public sealed class AgentsService
{
    private readonly IAgentRepository _repo;
    private readonly AgentTokenService _tokens;
    private readonly IAuditService _audit;

    public AgentsService(IAgentRepository repo, AgentTokenService tokens, IAuditService audit)
    {
        _repo = repo;
        _tokens = tokens;
        _audit = audit;
    }

    public Task<string> GenerateEnrollmentCodeAsync(
        string organizationId,
        string memberId,
        CancellationToken cancellationToken) =>
        _tokens.GenerateEnrollmentCodeAsync(organizationId, memberId, cancellationToken);

    public async Task<IReadOnlyList<AgentDto>> ListAgentsAsync(
        string organizationId,
        CancellationToken cancellationToken)
    {
        var agents = await _repo.ListByOrgAsync(organizationId, cancellationToken);
        return [.. agents.Select(agent => new AgentDto(
            agent.Id,
            agent.Name,
            agent.Platform,
            agent.Version,
            AgentStatusLabel.Of(agent.Status),
            agent.LastSeenAt))];
    }

    public async Task<IdResult> RevokeAgentAsync(
        string organizationId,
        string agentId,
        CancellationToken cancellationToken)
    {
        var agent = await AssertOrgScopeAsync(organizationId, agentId, cancellationToken);
        await _repo.SetStatusAsync(agentId, AgentStatus.Revoked, cancellationToken);
        await _audit.RecordUpdateAsync(
            organizationId,
            "Agent",
            agentId,
            [new AuditFieldChange("status", AgentStatusLabel.Of(agent.Status), "REVOKED")],
            cancellationToken);
        return new IdResult(agentId);
    }

    public async Task<IdResult> DeleteAgentAsync(
        string organizationId,
        string agentId,
        CancellationToken cancellationToken)
    {
        var agent = await AssertOrgScopeAsync(organizationId, agentId, cancellationToken);
        await _repo.DeleteAsync(agentId, cancellationToken);
        await _audit.RecordDeleteAsync(
            organizationId,
            "Agent",
            agentId,
            new
            {
                id = agent.Id,
                name = agent.Name,
                platform = agent.Platform,
                version = agent.Version,
                status = AgentStatusLabel.Of(agent.Status),
            },
            cancellationToken);
        return new IdResult(agentId);
    }

    private async Task<AgentRecord> AssertOrgScopeAsync(
        string organizationId,
        string agentId,
        CancellationToken cancellationToken)
    {
        var agent = await _repo.FindByIdAsync(agentId, cancellationToken);
        if (agent is null || !string.Equals(agent.OrganizationId, organizationId, StringComparison.Ordinal))
        {
            throw MonitoringErrors.AgentNotFound();
        }

        return agent;
    }
}
