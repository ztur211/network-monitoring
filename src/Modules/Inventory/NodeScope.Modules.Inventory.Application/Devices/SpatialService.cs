using System.Text.Json.Serialization;
using NodeScope.Contracts.Realtime;
using NodeScope.Modules.Inventory.Application.BuildingModels;
using NodeScope.Modules.Inventory.Application.Properties;
using NodeScope.Modules.Inventory.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Devices;

/// <summary>
/// Body of <c>PATCH /api/v1/devices/:id/position</c>. Absent and explicitly-null members are
/// both "unset" (Node's loose <c>== null</c>), so a plain <c>double?</c> models the wire exactly.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class DevicePositionRequest
{
    public double? X { get; init; }

    public double? Y { get; init; }

    public double? Z { get; init; }
}

/// <summary>Body of <c>PATCH /api/v1/devices/:id/ifc-link</c>.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class DeviceIfcLinkRequest
{
    public string? IfcGlobalId { get; init; }

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        RequestValidation.MaxLength(errors, IfcGlobalId, "ifcGlobalId", 64);
        return errors;
    }
}

/// <summary>
/// Device 3D placement and BIM linkage (Node's <c>SpatialService</c>). Both writes require the
/// device to sit under a modeled BUILDING (<c>SPATIAL_001</c>) - clearing never does, because
/// there is nothing left to anchor.
/// </summary>
public sealed class SpatialService
{
    private readonly IDeviceRepository _devices;
    private readonly IPropertyRepository _properties;
    private readonly IBuildingModelRepository _models;
    private readonly IPermissionScopeService _permissions;
    private readonly IRealtimeService _realtime;

    public SpatialService(
        IDeviceRepository devices,
        IPropertyRepository properties,
        IBuildingModelRepository models,
        IPermissionScopeService permissions,
        IRealtimeService realtime)
    {
        _devices = devices;
        _properties = properties;
        _models = models;
        _permissions = permissions;
        _realtime = realtime;
    }

    public async Task<DeviceDto> SetPositionAsync(
        OrgMemberContext member,
        string deviceId,
        DevicePositionRequest position,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(position);
        var device = await AuthorizedDeviceAsync(member, deviceId, cancellationToken);

        var allSet = position.X is not null && position.Y is not null && position.Z is not null;
        var allNull = position.X is null && position.Y is null && position.Z is null;
        if (!allSet && !allNull)
        {
            throw InventoryErrors.IncompletePosition();
        }

        if (allSet)
        {
            await AssertModeledBuildingAsync(member.OrganizationId, device.PropertyId, cancellationToken);
        }

        var updated = await _devices.SetPositionAsync(
            member.OrganizationId, deviceId, position.X, position.Y, position.Z, cancellationToken)
            ?? throw InventoryErrors.DeviceNotFound();

        object[] changes = [.. new[]
            {
                ("x", device.X, updated.X), ("y", device.Y, updated.Y), ("z", device.Z, updated.Z),
            }
            .Where(change => change.Item2 != change.Item3)
            .Select(change => new { field = change.Item1, oldValue = change.Item2, newValue = change.Item3 })];
        return await EmitUpdatedAsync(member.OrganizationId, deviceId, updated, changes, cancellationToken);
    }

    /// <summary>
    /// Links the device to a BIM element by the element's native IFC GlobalId, the only join key
    /// between the model and network data: the exported IFC carries GlobalIds but no IP/MAC, so a
    /// click on the BIM object resolves to live device info without the model embedding any.
    /// </summary>
    public async Task<DeviceDto> SetIfcLinkAsync(
        OrgMemberContext member,
        string deviceId,
        DeviceIfcLinkRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(request);
        var device = await AuthorizedDeviceAsync(member, deviceId, cancellationToken);

        var trimmed = request.IfcGlobalId?.Trim();
        var value = string.IsNullOrEmpty(trimmed) ? null : trimmed;
        if (value is not null)
        {
            await AssertModeledBuildingAsync(member.OrganizationId, device.PropertyId, cancellationToken);
        }

        var updated = await _devices.SetIfcLinkAsync(member.OrganizationId, deviceId, value, cancellationToken)
            ?? throw InventoryErrors.DeviceNotFound();

        object[] changes = device.IfcGlobalId == updated.IfcGlobalId
            ? []
            : [new { field = "ifcGlobalId", oldValue = device.IfcGlobalId, newValue = updated.IfcGlobalId }];
        return await EmitUpdatedAsync(member.OrganizationId, deviceId, updated, changes, cancellationToken);
    }

    /// <summary>Org-wide lookup then the F3 gate, so an out-of-scope ADMIN gets 403, not 404.</summary>
    private async Task<DeviceRecord> AuthorizedDeviceAsync(
        OrgMemberContext member,
        string deviceId,
        CancellationToken cancellationToken)
    {
        var device = await _devices.FindAsync(member.OrganizationId, deviceId, null, cancellationToken)
            ?? throw InventoryErrors.DeviceNotFound();
        await _permissions.AssertCanConfigureAsync(member, device.PropertyId, cancellationToken);
        return device;
    }

    private async Task AssertModeledBuildingAsync(
        string organizationId,
        string propertyId,
        CancellationToken cancellationToken)
    {
        var chain = await _properties.AncestorChainAsync(organizationId, propertyId, cancellationToken);
        var buildingId = chain.FirstOrDefault(node => node.Type == PropertyType.Building)?.Id;
        if (buildingId is null
            || !await _models.ExistsForPropertyAsync(organizationId, buildingId, cancellationToken))
        {
            throw InventoryErrors.DeviceNotInModeledBuilding();
        }
    }

    private async Task<DeviceDto> EmitUpdatedAsync(
        string organizationId,
        string deviceId,
        DeviceRecord updated,
        object[] changes,
        CancellationToken cancellationToken)
    {
        var dto = updated.ToDto();
        await _realtime.EmitScopedAsync(
            organizationId,
            updated.PropertyId,
            WsEvents.DeviceUpdated,
            new
            {
                deviceId,
                device = dto,
                changes,
                updatedBy = updated.UserId ?? "",
                timestamp = IsoTimestamp.Now(),
            },
            cancellationToken);
        return dto;
    }
}
