using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Properties;

/// <summary>
/// The device-placement invariant (Node's <c>ContainmentService</c>): every device must sit
/// at or under one of its network's chartered sites, and no reparent or charter removal may
/// silently break that.
/// </summary>
public sealed class ContainmentService
{
    private readonly IPropertyRepository _properties;
    private readonly INetworkPropertyRepository _charters;

    public ContainmentService(IPropertyRepository properties, INetworkPropertyRepository charters)
    {
        _properties = properties;
        _charters = charters;
    }

    /// <summary><c>PROP_007</c> unless <paramref name="propertyId"/> is at/under one of the network's chartered sites.</summary>
    public async Task AssertDevicePlacementAsync(
        string organizationId,
        string networkId,
        string propertyId,
        CancellationToken cancellationToken)
    {
        var ancestors = await _properties.AncestorIdsAsync(organizationId, propertyId, cancellationToken);
        var charterProps = await _charters.PropertyIdsByNetworkAsync(organizationId, networkId, cancellationToken);
        if (!Intersects(ancestors, charterProps))
        {
            throw InventoryErrors.DeviceNotInCharteredSite();
        }
    }

    /// <summary>
    /// <c>PROP_007</c> if moving <paramref name="movedId"/> under <paramref name="newParentId"/>
    /// would orphan any placed device in the moved subtree. Post-move ancestors of a device =
    /// (its ancestors that stay within the moved subtree) union (the new parent and its ancestors).
    /// </summary>
    public async Task AssertReparentKeepsContainmentAsync(
        string organizationId,
        string movedId,
        string? newParentId,
        CancellationToken cancellationToken)
    {
        var subtree = await _properties.SubtreeIdsAsync(organizationId, movedId, cancellationToken);
        var devices = await _properties.DevicesUnderAsync(organizationId, subtree, cancellationToken);
        if (devices.Count == 0)
        {
            return;
        }

        var newAbove = newParentId is null
            ? []
            : await _properties.AncestorIdsAsync(organizationId, newParentId, cancellationToken);
        var subtreeSet = new HashSet<string>(subtree, StringComparer.Ordinal);
        var charterCache = new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal);

        foreach (var device in devices)
        {
            var deviceAncestors = await _properties.AncestorIdsAsync(organizationId, device.PropertyId, cancellationToken);
            var post = new HashSet<string>(deviceAncestors.Where(subtreeSet.Contains), StringComparer.Ordinal);
            post.UnionWith(newAbove);
            if (!charterCache.TryGetValue(device.NetworkId, out var charterProps))
            {
                charterProps = await _charters.PropertyIdsByNetworkAsync(organizationId, device.NetworkId, cancellationToken);
                charterCache[device.NetworkId] = charterProps;
            }

            if (!charterProps.Any(post.Contains))
            {
                throw InventoryErrors.DeviceNotInCharteredSite();
            }
        }
    }

    /// <summary><c>PROP_008</c> if removing the charter leaves any of the network's devices uncovered.</summary>
    public async Task AssertCharterRemovableAsync(
        string organizationId,
        string networkId,
        string propertyId,
        CancellationToken cancellationToken)
    {
        var removedSubtree = await _properties.SubtreeIdsAsync(organizationId, propertyId, cancellationToken);
        var devices = (await _properties.DevicesUnderAsync(organizationId, removedSubtree, cancellationToken))
            .Where(device => device.NetworkId == networkId)
            .ToList();
        if (devices.Count == 0)
        {
            return;
        }

        var remaining = (await _charters.PropertyIdsByNetworkAsync(organizationId, networkId, cancellationToken))
            .Where(id => id != propertyId)
            .ToList();
        foreach (var device in devices)
        {
            var ancestors = await _properties.AncestorIdsAsync(organizationId, device.PropertyId, cancellationToken);
            if (!Intersects(ancestors, remaining))
            {
                throw InventoryErrors.CharterInUse();
            }
        }
    }

    private static bool Intersects(IReadOnlyCollection<string> a, IReadOnlyCollection<string> b)
    {
        var set = new HashSet<string>(a, StringComparer.Ordinal);
        return b.Any(set.Contains);
    }
}
