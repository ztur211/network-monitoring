using NodeScope.Contracts.Realtime;
using NodeScope.Modules.Inventory.Application.Devices;
using NodeScope.Modules.Inventory.Application.Properties;
using NodeScope.Modules.Inventory.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.BuildingModels;

/// <summary>
/// The building model's georeference and its consequences. Writing one turns every placed
/// device's map pin into a projection of its 3D placement, so the write re-derives
/// latitude/longitude for the building's placed fleet and emits the usual device updates.
/// </summary>
public sealed class GeoreferenceService
{
    private readonly IBuildingModelRepository _models;
    private readonly IDeviceRepository _devices;
    private readonly IPropertyRepository _properties;
    private readonly IPermissionScopeService _permissions;
    private readonly IRealtimeService _realtime;
    private readonly IAuditService _audit;

    public GeoreferenceService(
        IBuildingModelRepository models,
        IDeviceRepository devices,
        IPropertyRepository properties,
        IPermissionScopeService permissions,
        IRealtimeService realtime,
        IAuditService audit)
    {
        _models = models;
        _devices = devices;
        _properties = properties;
        _permissions = permissions;
        _realtime = realtime;
        _audit = audit;
    }

    public async Task<BuildingModelDto> SetGeoreferenceAsync(
        OrgMemberContext member,
        string propertyId,
        SetGeoreferenceRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(request);
        await _permissions.AssertCanConfigureAsync(member, propertyId, cancellationToken);
        var model = await _models.FindByPropertyAsync(member.OrganizationId, propertyId, cancellationToken)
            ?? throw InventoryErrors.BuildingModelNotFound();

        var georeference = request.ToGeoreference();
        if (!await _models.SetGeoreferenceAsync(
            member.OrganizationId, model.Id, georeference, model.Version, cancellationToken))
        {
            throw Changesets.EditConflict();
        }

        await _audit.RecordUpdateAsync(
            member.OrganizationId,
            "BuildingModel",
            model.Id,
            [new AuditFieldChange("georeference", Describe(model.Georeference), Describe(georeference))],
            cancellationToken);
        await _realtime.PushToOrgAsync(
            member.OrganizationId,
            WsEvents.BuildingModelGeoreferenceSet,
            new { propertyId, georeference },
            cancellationToken);

        if (georeference is not null)
        {
            await RederivePlacedDevicesAsync(member.OrganizationId, propertyId, georeference, cancellationToken);
        }

        var updated = await _models.FindByPropertyAsync(member.OrganizationId, propertyId, cancellationToken)
            ?? throw InventoryErrors.BuildingModelNotFound();
        return updated.ToDto();
    }

    /// <summary>Every placed device under the building gets its pin re-projected.</summary>
    private async Task RederivePlacedDevicesAsync(
        string organizationId,
        string buildingPropertyId,
        ModelGeoreference georeference,
        CancellationToken cancellationToken)
    {
        var subtree = await _properties.SubtreeIdsAsync(organizationId, buildingPropertyId, cancellationToken);
        var placed = await _devices.ListPlacedAsync(organizationId, subtree, cancellationToken);
        foreach (var device in placed)
        {
            var (latitude, longitude) = georeference.Project(device.X!.Value, device.Y!.Value);
            if (device.Latitude == latitude && device.Longitude == longitude)
            {
                continue;
            }

            var updated = await _devices.SetDerivedLocationAsync(
                organizationId, device.Id, latitude, longitude, cancellationToken);
            if (updated is null)
            {
                continue; // deleted mid-derive; nothing to update or announce
            }

            object[] changes = [.. new[]
                {
                    ("latitude", device.Latitude, updated.Latitude),
                    ("longitude", device.Longitude, updated.Longitude),
                }
                .Where(change => change.Item2 != change.Item3)
                .Select(change => new { field = change.Item1, oldValue = change.Item2, newValue = change.Item3 })];
            await _realtime.EmitScopedAsync(
                organizationId,
                updated.PropertyId,
                WsEvents.DeviceUpdated,
                new
                {
                    deviceId = device.Id,
                    device = updated.ToDto(),
                    changes,
                    updatedBy = updated.UserId ?? "",
                    timestamp = IsoTimestamp.Now(),
                },
                cancellationToken);
        }
    }

    private static string? Describe(ModelGeoreference? georeference) => georeference is null
        ? null
        : FormattableString.Invariant(
            $"({georeference.AnchorLatitude}, {georeference.AnchorLongitude}) at ({georeference.AnchorX}, {georeference.AnchorY}), rotation {georeference.RotationDegrees}°, {georeference.MetersPerUnit} m/unit");
}
