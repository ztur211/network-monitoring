using NodeScope.Contracts.Realtime;
using NodeScope.Modules.Inventory.Application.BuildingModels;
using NodeScope.Modules.Inventory.Application.Properties;
using NodeScope.Modules.Inventory.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Devices;

/// <summary>Device CRUD, ported from Node's <c>DevicesService</c>.</summary>
public sealed class DevicesService
{
    private readonly IDeviceRepository _devices;
    private readonly IPropertyRepository _properties;
    private readonly IOrgNamingPolicyReader _orgs;
    private readonly IBuildingModelRepository _models;
    private readonly ContainmentService _containment;
    private readonly IPermissionScopeService _permissions;
    private readonly IRealtimeService _realtime;
    private readonly IAuditService _audit;

    public DevicesService(
        IDeviceRepository devices,
        IPropertyRepository properties,
        IOrgNamingPolicyReader orgs,
        IBuildingModelRepository models,
        ContainmentService containment,
        IPermissionScopeService permissions,
        IRealtimeService realtime,
        IAuditService audit)
    {
        _devices = devices;
        _properties = properties;
        _orgs = orgs;
        _models = models;
        _containment = containment;
        _permissions = permissions;
        _realtime = realtime;
        _audit = audit;
    }

    public async Task<DeviceListDto> ListAsync(OrgMemberContext member, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var scope = await _permissions.ScopePropertyIdsAsync(member, cancellationToken);
        var items = await _devices.ListAsync(member.OrganizationId, scope, cancellationToken);
        var total = await _devices.CountAsync(member.OrganizationId, scope, cancellationToken);
        return new DeviceListDto([.. items.Select(device => device.ToDto())], total);
    }

    /// <summary>
    /// The building's devices for the 3D viewport: the building subtree intersected with the
    /// caller's read scope. Unpaginated - a building's in-scope set loads whole.
    /// </summary>
    public async Task<IReadOnlyList<DeviceDto>> ListForBuildingAsync(
        OrgMemberContext member,
        string buildingPropertyId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var subtree = await _properties.SubtreeIdsAsync(member.OrganizationId, buildingPropertyId, cancellationToken);
        var scope = await _permissions.ScopePropertyIdsAsync(member, cancellationToken);
        var propertyIds = scope is null
            ? subtree
            : [.. subtree.Where(id => scope.Contains(id, StringComparer.Ordinal))];
        if (propertyIds.Count == 0)
        {
            return [];
        }

        var items = await _devices.ListAsync(member.OrganizationId, propertyIds, cancellationToken);
        return [.. items.Select(device => device.ToDto())];
    }

    public async Task<DeviceDto> CreateAsync(
        OrgMemberContext member,
        string creatorUserId,
        CreateDeviceRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(request);
        await _permissions.AssertCanConfigureAsync(member, request.PropertyId!, cancellationToken);
        var organizationId = member.OrganizationId;

        var policy = await _orgs.FindAsync(organizationId, cancellationToken)
            ?? throw InventoryErrors.OrganizationNotFound();
        var name = request.TrimmedName!;
        if (await _devices.NameExistsAsync(organizationId, name, null, cancellationToken))
        {
            throw InventoryErrors.DeviceNameTaken();
        }

        NamingPolicy.AssertNameMatchesPolicy(name, policy.NamingPattern, policy.NamingMaxLen);
        await _containment.AssertDevicePlacementAsync(
            organizationId, request.NetworkId!, request.PropertyId!, cancellationToken);

        var device = await _devices.CreateAsync(
            new NewDevice(
                organizationId,
                creatorUserId,
                name,
                DeviceCategoryLabels.TryParse(request.Category)!.Value,
                DeviceMobility.Unknown,
                request.NetworkId!,
                request.PropertyId!,
                request.RoleCode,
                request.Latitude,
                request.Longitude,
                request.Floor,
                request.TrimmedFloorLabel,
                request.IpAddress,
                request.MacAddress,
                request.Notes),
            cancellationToken);
        var dto = device.ToDto();
        await _audit.RecordCreateAsync(organizationId, "Device", device.Id, dto, cancellationToken);
        return dto;
    }

    public async Task<DeviceDto> GetAsync(OrgMemberContext member, string deviceId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var scope = await _permissions.ScopePropertyIdsAsync(member, cancellationToken);
        var device = await _devices.FindAsync(member.OrganizationId, deviceId, scope, cancellationToken)
            ?? throw InventoryErrors.DeviceNotFound();
        return device.ToDto();
    }

    public async Task<DeviceDto> UpdateAsync(
        OrgMemberContext member,
        string deviceId,
        ChangesetRequest patch,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(patch);
        var organizationId = member.OrganizationId;
        // Write path: org-wide lookup (no scope) so an out-of-scope ADMIN gets PERM_001, not 404.
        var device = await _devices.FindAsync(organizationId, deviceId, null, cancellationToken)
            ?? throw InventoryErrors.DeviceNotFound();
        await _permissions.AssertCanConfigureAsync(member, device.PropertyId, cancellationToken);

        var changes = patch.Changes ?? [];
        var propertyChange = changes.FirstOrDefault(change => change.Field == "propertyId");
        var networkChange = changes.FirstOrDefault(change => change.Field == "networkId");
        var nextPropertyId = propertyChange is null
            ? device.PropertyId
            : ChangesetValues.AsString(propertyChange.NewValue) ?? device.PropertyId;
        if (nextPropertyId != device.PropertyId)
        {
            await _permissions.AssertCanConfigureAsync(member, nextPropertyId, cancellationToken);
        }

        var payload = Changesets.BuildUpdatePayload(patch, DeviceFields.Writable, device.Version, DeviceFields.IsValid);

        if (payload.TryGetValue("name", out var nameValue))
        {
            var policy = await _orgs.FindAsync(organizationId, cancellationToken)
                ?? throw InventoryErrors.OrganizationNotFound();
            var nextName = ChangesetValues.AsString(nameValue)!;
            if (await _devices.NameExistsAsync(organizationId, nextName, deviceId, cancellationToken))
            {
                throw InventoryErrors.DeviceNameTaken();
            }

            NamingPolicy.AssertNameMatchesPolicy(nextName, policy.NamingPattern, policy.NamingMaxLen);
        }

        if (propertyChange is not null || networkChange is not null)
        {
            var nextNetworkId = networkChange is null
                ? device.NetworkId
                : ChangesetValues.AsString(networkChange.NewValue) ?? device.NetworkId;
            await _containment.AssertDevicePlacementAsync(
                organizationId, nextNetworkId, nextPropertyId, cancellationToken);
        }

        // Model-local x/y/z are expressed in the governing BUILDING's frame, so a move that
        // changes that building makes them meaningless.
        var clearModelCoordinates = nextPropertyId != device.PropertyId
            && await GoverningBuildingIdAsync(organizationId, device.PropertyId, cancellationToken)
                != await GoverningBuildingIdAsync(organizationId, nextPropertyId, cancellationToken);

        // While a device is placed in a georeferenced model, its map pin is a projection of the
        // 3D placement - a direct latitude/longitude write would silently diverge from it.
        if ((payload.ContainsKey("latitude") || payload.ContainsKey("longitude"))
            && !clearModelCoordinates
            && device is { X: not null, Y: not null, Z: not null }
            && await GoverningBuildingIdAsync(organizationId, device.PropertyId, cancellationToken)
                is { } governingBuildingId
            && (await _models.FindByPropertyAsync(organizationId, governingBuildingId, cancellationToken))
                ?.Georeference is not null)
        {
            throw InventoryErrors.DeviceLocationDerived();
        }

        var updated = await _devices.UpdateWithVersionAsync(
            organizationId, deviceId, payload, clearModelCoordinates, patch.BaseVersion!.Value, cancellationToken)
            ?? throw Changesets.EditConflict();

        var dto = updated.ToDto();
        await _audit.RecordUpdateAsync(
            organizationId, "Device", deviceId, ChangesetAudit.ToFieldChanges(patch), cancellationToken);
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

    public async Task DeleteAsync(OrgMemberContext member, string deviceId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var organizationId = member.OrganizationId;
        var device = await _devices.FindAsync(organizationId, deviceId, null, cancellationToken)
            ?? throw InventoryErrors.DeviceNotFound();
        await _permissions.AssertCanConfigureAsync(member, device.PropertyId, cancellationToken);
        await _devices.DeleteAsync(organizationId, deviceId, cancellationToken);
        await _audit.RecordDeleteAsync(organizationId, "Device", deviceId, device.ToDto(), cancellationToken);
        await _realtime.EmitScopedAsync(
            organizationId,
            device.PropertyId,
            WsEvents.DeviceDeleted,
            new { deviceId, timestamp = IsoTimestamp.Now() },
            cancellationToken);
    }

    private async Task<string?> GoverningBuildingIdAsync(
        string organizationId,
        string propertyId,
        CancellationToken cancellationToken)
    {
        var chain = await _properties.AncestorChainAsync(organizationId, propertyId, cancellationToken);
        return chain.FirstOrDefault(node => node.Type == PropertyType.Building)?.Id;
    }
}
