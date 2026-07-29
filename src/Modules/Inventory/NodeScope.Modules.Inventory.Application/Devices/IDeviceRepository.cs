using System.Text.Json;

namespace NodeScope.Modules.Inventory.Application.Devices;

/// <summary>Device persistence (Node's <c>DevicesRepository</c>).</summary>
public interface IDeviceRepository
{
    /// <summary>Ordered by <c>createdAt</c> descending; a non-null scope restricts by placement.</summary>
    public Task<IReadOnlyList<DeviceRecord>> ListAsync(
        string organizationId,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken);

    public Task<int> CountAsync(
        string organizationId,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken);

    public Task<DeviceRecord?> FindAsync(
        string organizationId,
        string deviceId,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken);

    public Task<IReadOnlyList<DeviceRecord>> ListByIdsAsync(
        string organizationId,
        IReadOnlyCollection<string> deviceIds,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken);

    public Task<DeviceRecord> CreateAsync(NewDevice device, CancellationToken cancellationToken);

    /// <summary>
    /// Atomic conditional update; null when the version no longer matches.
    /// <paramref name="clearModelCoordinates"/> nulls x/y/z, which a governing-building change forces.
    /// </summary>
    public Task<DeviceRecord?> UpdateWithVersionAsync(
        string organizationId,
        string deviceId,
        IReadOnlyDictionary<string, JsonElement> fields,
        bool clearModelCoordinates,
        int expectedVersion,
        CancellationToken cancellationToken);

    /// <summary>
    /// Writes the model-local coordinate triple and bumps the version; null when the device is
    /// gone. A non-null <paramref name="location"/> also overwrites latitude/longitude in the
    /// same update (its null members clear them), keeping a derived map pin atomic with the
    /// 3D placement it comes from.
    /// </summary>
    public Task<DeviceRecord?> SetPositionAsync(
        string organizationId,
        string deviceId,
        double? x,
        double? y,
        double? z,
        DerivedLocation? location,
        CancellationToken cancellationToken);

    /// <summary>Devices with a full x/y/z placement on any of the given properties.</summary>
    public Task<IReadOnlyList<DeviceRecord>> ListPlacedAsync(
        string organizationId,
        IReadOnlyCollection<string> propertyIds,
        CancellationToken cancellationToken);

    /// <summary>Overwrites the derived latitude/longitude pair and bumps the version.</summary>
    public Task<DeviceRecord?> SetDerivedLocationAsync(
        string organizationId,
        string deviceId,
        double latitude,
        double longitude,
        CancellationToken cancellationToken);

    /// <summary>Sets (or clears) the linked IFC element GlobalId and bumps the version.</summary>
    public Task<DeviceRecord?> SetIfcLinkAsync(
        string organizationId,
        string deviceId,
        string? ifcGlobalId,
        CancellationToken cancellationToken);

    public Task DeleteAsync(string organizationId, string deviceId, CancellationToken cancellationToken);

    /// <summary>Case-insensitive org-wide name collision (device names are unique per org).</summary>
    public Task<bool> NameExistsAsync(
        string organizationId,
        string name,
        string? excludeDeviceId,
        CancellationToken cancellationToken);
}
