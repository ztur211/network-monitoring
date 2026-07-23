namespace NodeScope.Modules.Inventory.Application.Properties;

/// <summary>A <c>NetworkProperty</c> charter row as the application layer sees it.</summary>
public sealed record CharterRecord(string Id, string OrganizationId, string NetworkId, string PropertyId);

/// <summary>Charter persistence (Node's <c>NetworkPropertyRepository</c>).</summary>
public interface INetworkPropertyRepository
{
    public Task<CharterRecord> CreateAsync(
        string organizationId,
        string networkId,
        string propertyId,
        CancellationToken cancellationToken);

    public Task<bool> CharterExistsAsync(
        string organizationId,
        string networkId,
        string propertyId,
        CancellationToken cancellationToken);

    public Task<CharterRecord?> FindCharterAsync(
        string organizationId,
        string networkId,
        string propertyId,
        CancellationToken cancellationToken);

    /// <summary>Ordered by <c>createdAt</c> ascending.</summary>
    public Task<IReadOnlyList<CharterRecord>> ListByNetworkAsync(
        string organizationId,
        string networkId,
        CancellationToken cancellationToken);

    public Task<IReadOnlyList<string>> PropertyIdsByNetworkAsync(
        string organizationId,
        string networkId,
        CancellationToken cancellationToken);

    public Task DeleteAsync(
        string organizationId,
        string networkId,
        string propertyId,
        CancellationToken cancellationToken);

    /// <summary>Distinct property ids where the network's devices are placed.</summary>
    public Task<IReadOnlyList<string>> DeviceFootprintPropertyIdsAsync(
        string organizationId,
        string networkId,
        CancellationToken cancellationToken);
}
