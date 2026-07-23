using System.Text.Json;

namespace NodeScope.Modules.Inventory.Application.Networks;

/// <summary>Network persistence (Node's <c>NetworksRepository</c>).</summary>
public interface INetworkRepository
{
    public Task<int> CountByOrgAsync(string organizationId, CancellationToken cancellationToken);

    public Task<NetworkRecord?> FindAsync(string organizationId, string networkId, CancellationToken cancellationToken);

    /// <summary>
    /// Networks visible to the scope: unscoped lists all; scoped requires a chartered site
    /// or a placed device inside the scope. Ordered by <c>createdAt</c> descending.
    /// </summary>
    public Task<IReadOnlyList<NetworkRecord>> ListVisibleAsync(
        string organizationId,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken);

    public Task<NetworkRecord?> FindVisibleAsync(
        string organizationId,
        string networkId,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken);

    public Task<IReadOnlyList<string>> CharteredPropertyIdsAsync(
        string organizationId,
        string networkId,
        CancellationToken cancellationToken);

    public Task<IReadOnlyList<string>> DeviceFootprintPropertyIdsAsync(
        string organizationId,
        string networkId,
        CancellationToken cancellationToken);

    public Task<NetworkRecord> CreateAsync(NewNetwork network, CancellationToken cancellationToken);

    /// <summary>Atomic conditional update; null when the version no longer matches.</summary>
    public Task<NetworkRecord?> UpdateWithVersionAsync(
        string organizationId,
        string networkId,
        IReadOnlyDictionary<string, JsonElement> fields,
        int expectedVersion,
        CancellationToken cancellationToken);

    public Task DeleteAsync(string organizationId, string networkId, CancellationToken cancellationToken);
}
