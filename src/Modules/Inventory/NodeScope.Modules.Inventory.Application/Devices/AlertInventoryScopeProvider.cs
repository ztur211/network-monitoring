using NodeScope.Modules.Inventory.Application.Properties;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Devices;

/// <summary>
/// Resolves alert selectors against Inventory's organization and property-tree rules.
/// Invalid or foreign ids simply select nothing, so a malformed selector can never widen.
/// </summary>
public sealed class AlertInventoryScopeProvider : IAlertInventoryScope
{
    private readonly IDeviceRepository _devices;
    private readonly IPropertyRepository _properties;

    public AlertInventoryScopeProvider(IDeviceRepository devices, IPropertyRepository properties)
    {
        _devices = devices;
        _properties = properties;
    }

    public async Task<bool> ContainsAsync(
        string organizationId,
        AlertScopeSelection scope,
        string deviceId,
        string networkId,
        string propertyId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        if (scope.All)
        {
            return true;
        }

        if (scope.DeviceIds.Contains(deviceId, StringComparer.Ordinal)
            || scope.NetworkIds.Contains(networkId, StringComparer.Ordinal))
        {
            return true;
        }

        foreach (var rootId in scope.PropertyIds)
        {
            if (await _properties.IsAtOrUnderAsync(
                    organizationId, propertyId, rootId, cancellationToken))
            {
                return true;
            }
        }

        return false;
    }

    public async Task<IReadOnlyList<string>?> ResolveDeviceIdsAsync(
        string organizationId,
        AlertScopeSelection scope,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        if (scope.All)
        {
            return null;
        }

        var result = new HashSet<string>(StringComparer.Ordinal);
        if (scope.DeviceIds.Count > 0)
        {
            var owned = await _devices.ListByIdsAsync(
                organizationId, scope.DeviceIds, null, cancellationToken);
            result.UnionWith(owned.Select(device => device.Id));
        }

        if (scope.NetworkIds.Count > 0)
        {
            var devices = await _devices.ListAsync(organizationId, null, cancellationToken);
            result.UnionWith(devices
                .Where(device => scope.NetworkIds.Contains(device.NetworkId, StringComparer.Ordinal))
                .Select(device => device.Id));
        }

        if (scope.PropertyIds.Count > 0)
        {
            var properties = new HashSet<string>(StringComparer.Ordinal);
            foreach (var rootId in scope.PropertyIds)
            {
                properties.UnionWith(
                    await _properties.SubtreeIdsAsync(organizationId, rootId, cancellationToken));
            }

            if (properties.Count > 0)
            {
                var devices = await _devices.ListAsync(organizationId, properties, cancellationToken);
                result.UnionWith(devices.Select(device => device.Id));
            }
        }

        return [.. result];
    }
}
