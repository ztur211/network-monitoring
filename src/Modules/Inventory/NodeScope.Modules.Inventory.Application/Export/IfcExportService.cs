using System.Text;
using System.Text.RegularExpressions;
using NodeScope.Modules.Inventory.Application.Devices;
using NodeScope.Modules.Inventory.Application.Properties;
using NodeScope.Modules.Inventory.Domain;
using NodeScope.Modules.Inventory.Domain.Export;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Export;

/// <summary>A rendered IFC file, ready to stream back.</summary>
public sealed record IfcExport(string FileName, ReadOnlyMemory<byte> Content);

/// <summary>
/// The federated IFC network-discipline export (Node's <c>ExportService</c>): a building's
/// in-scope, placed devices as a downloadable IFC2x3 file. A MEMBER may export - it is a read.
/// </summary>
public sealed partial class IfcExportService
{
    private readonly IPropertyRepository _properties;
    private readonly IDeviceRepository _devices;
    private readonly IPermissionScopeService _permissions;

    public IfcExportService(
        IPropertyRepository properties,
        IDeviceRepository devices,
        IPermissionScopeService permissions)
    {
        _properties = properties;
        _devices = devices;
        _permissions = permissions;
    }

    public async Task<IfcExport> ExportBuildingAsync(
        OrgMemberContext member,
        string buildingPropertyId,
        DateTime timestamp,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var organizationId = member.OrganizationId;
        var building = await _properties.FindAsync(organizationId, buildingPropertyId, null, cancellationToken);

        // Only BUILDINGs export, and an out-of-scope building is invisible rather than forbidden:
        // a SITE, an unknown id, and an out-of-scope building are all the same 404.
        if (building is null
            || building.Type != PropertyType.Building
            || !await _permissions.IsInScopeAsync(member, buildingPropertyId, cancellationToken))
        {
            throw InventoryErrors.PropertyNotFound();
        }

        var subtree = await _properties.SubtreeIdsAsync(organizationId, buildingPropertyId, cancellationToken);
        var scope = await _permissions.ScopePropertyIdsAsync(member, cancellationToken);
        var propertyIds = scope is null
            ? subtree
            : [.. subtree.Where(id => scope.Contains(id, StringComparer.Ordinal))];

        var devices = propertyIds.Count == 0
            ? []
            : (await _devices.ListAsync(organizationId, propertyIds, cancellationToken))
                .Where(device => device.X is not null && device.Y is not null && device.Z is not null)
                .Select(device => new ExportDevice(device.Id, device.X!.Value, device.Y!.Value, device.Z!.Value))
                .ToList();

        var ifc = Ifc2x3Writer.BuildNetworkIfc(
            building.Id, building.Name, "Network", devices, timestamp);
        return new IfcExport(
            $"{UnsafeFileNameChars().Replace(building.Name, "_")}-network.ifc",
            Encoding.UTF8.GetBytes(ifc));
    }

    [GeneratedRegex(@"[^\w.-]+")]
    private static partial Regex UnsafeFileNameChars();
}
