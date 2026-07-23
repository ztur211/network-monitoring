using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using NodeScope.Modules.Monitoring.Domain;

namespace NodeScope.Modules.Monitoring.Application.Agents;

/// <summary>The org/agent pair a verified <c>x-agent-token</c> resolves to.</summary>
public sealed record AgentIdentity(string OrganizationId, string AgentId);

/// <summary>The one-time enrollment result; the token plaintext is never stored.</summary>
public sealed record EnrollResult(string AgentId, string Token);

/// <summary>
/// Agent enrollment and token verification, ported from the Node <c>AgentTokenService</c>:
/// short-lived single-use enrollment codes (15 min, hash stored), persistent agent tokens
/// (SHA-256 hex hash stored, plaintext shown once), revoked agents verify as unknown.
/// </summary>
public sealed class AgentTokenService
{
    private static readonly TimeSpan CodeTtl = TimeSpan.FromMinutes(15);

    private readonly IAgentRepository _repo;

    public AgentTokenService(IAgentRepository repo)
    {
        _repo = repo;
    }

    public async Task<string> GenerateEnrollmentCodeAsync(
        string organizationId,
        string? memberId,
        CancellationToken cancellationToken)
    {
        var code = RandomBase64Url(18);
        await _repo.CreateEnrollmentCodeAsync(
            organizationId,
            Sha256Hex(code),
            DateTime.UtcNow + CodeTtl,
            memberId,
            cancellationToken);
        return code;
    }

    public async Task<EnrollResult> EnrollAsync(
        string code,
        string name,
        string platform,
        string version,
        CancellationToken cancellationToken)
    {
        var token = RandomBase64Url(32);
        var agentId = await _repo.RedeemCodeAndCreateAgentAsync(
            Sha256Hex(code),
            name,
            platform,
            version,
            Sha256Hex(token),
            cancellationToken);
        return agentId is null
            ? throw MonitoringErrors.InvalidEnrollmentCode()
            : new EnrollResult(agentId, token);
    }

    /// <summary>Resolves a presented token, or null for unknown/revoked agents.</summary>
    public async Task<AgentIdentity?> VerifyTokenAsync(string token, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(token))
        {
            return null;
        }

        var agent = await _repo.FindByTokenHashAsync(Sha256Hex(token), cancellationToken);
        return agent is null || agent.Status == AgentStatus.Revoked
            ? null
            : new AgentIdentity(agent.OrganizationId, agent.Id);
    }

    internal static string Sha256Hex(string value) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    private static string RandomBase64Url(int bytes) =>
        Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(bytes));
}
