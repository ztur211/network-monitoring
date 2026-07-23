using System.Buffers.Text;
using System.Security.Cryptography;
using NodeScope.Modules.Monitoring.Application.Agents;

namespace NodeScope.Modules.Monitoring.Application.Ingest;

/// <summary>Persistence for the one-per-org ingest token (hash only).</summary>
public interface IIngestTokenRepository
{
    /// <summary>Upserts the org's token hash (rotation overwrites; the old token dies instantly).</summary>
    public Task UpsertAsync(string organizationId, string tokenHash, CancellationToken cancellationToken);

    /// <summary>The owning org of a token hash, or null.</summary>
    public Task<string?> FindOrganizationByTokenHashAsync(string tokenHash, CancellationToken cancellationToken);
}

/// <summary>
/// The per-org ingest secret (Node's <c>IngestTokenService</c>): plaintext shown once at
/// (re)generation, only its SHA-256 stored; rotation is the only revocation.
/// </summary>
public sealed class IngestTokenService
{
    private readonly IIngestTokenRepository _repo;

    public IngestTokenService(IIngestTokenRepository repo)
    {
        _repo = repo;
    }

    public async Task<string> CreateOrRotateAsync(string organizationId, CancellationToken cancellationToken)
    {
        var secret = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(32));
        await _repo.UpsertAsync(organizationId, AgentTokenService.Sha256Hex(secret), cancellationToken);
        return secret;
    }

    /// <summary>The org a presented token belongs to, or null.</summary>
    public Task<string?> VerifyAsync(string token, CancellationToken cancellationToken) =>
        string.IsNullOrEmpty(token)
            ? Task.FromResult<string?>(null)
            : _repo.FindOrganizationByTokenHashAsync(AgentTokenService.Sha256Hex(token), cancellationToken);
}
