namespace NodeScope.Platform.Abstractions;

/// <summary>
/// Whether the address a user is connecting from matches their network's recorded home public
/// IP. Realtime asks; Inventory answers, because it owns the Network row.
/// </summary>
public interface IHomeNetworkProbe
{
    public Task<HomeNetworkStatus> CheckAsync(string userId, string requestIp, CancellationToken cancellationToken);
}

/// <summary>The user's network and whether they appear to be on it (no network: null, false).</summary>
public sealed record HomeNetworkStatus(string? NetworkId, bool OnHome);
