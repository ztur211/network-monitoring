using NodeScope.Modules.Inventory.Application.Devices;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Links;

/// <summary>
/// The two-endpoint rule shared by fiber runs and device connections: both endpoint devices must
/// exist (<c>DEVICE_001</c>), and the caller must be able to configure BOTH governing sites -
/// a MEMBER is <c>ORG_003</c>, an ADMIN missing either side is <c>PERM_001</c>.
/// </summary>
public sealed class LinkEndpoints
{
    private readonly IDeviceRepository _devices;
    private readonly IPermissionScopeService _permissions;

    public LinkEndpoints(IDeviceRepository devices, IPermissionScopeService permissions)
    {
        _devices = devices;
        _permissions = permissions;
    }

    /// <summary>Resolves both endpoints' sites and authorizes the caller against each.</summary>
    public async Task<(string First, string Second)> AuthorizeBothAsync(
        OrgMemberContext member,
        string firstDeviceId,
        string secondDeviceId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var sites = await ResolveSitesAsync(member.OrganizationId, firstDeviceId, secondDeviceId, cancellationToken);
        await _permissions.AssertCanConfigureAsync(member, sites.First, cancellationToken);
        await _permissions.AssertCanConfigureAsync(member, sites.Second, cancellationToken);
        return sites;
    }

    private async Task<(string First, string Second)> ResolveSitesAsync(
        string organizationId,
        string firstDeviceId,
        string secondDeviceId,
        CancellationToken cancellationToken)
    {
        var first = await _devices.FindAsync(organizationId, firstDeviceId, null, cancellationToken);
        var second = await _devices.FindAsync(organizationId, secondDeviceId, null, cancellationToken);
        if (first is null || second is null)
        {
            throw InventoryErrors.DeviceNotFound();
        }

        return (first.PropertyId, second.PropertyId);
    }
}
