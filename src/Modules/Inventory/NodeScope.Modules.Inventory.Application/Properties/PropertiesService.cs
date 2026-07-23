using System.Text.Json;
using NodeScope.Contracts.Realtime;
using NodeScope.Modules.Inventory.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Properties;

/// <summary>The property hierarchy's CRUD, ported from Node's <c>PropertiesService</c>.</summary>
public sealed class PropertiesService
{
    private readonly IPropertyRepository _properties;
    private readonly ContainmentService _containment;
    private readonly IPermissionScopeService _permissions;
    private readonly IRealtimeService _realtime;
    private readonly IAuditService _audit;

    public PropertiesService(
        IPropertyRepository properties,
        ContainmentService containment,
        IPermissionScopeService permissions,
        IRealtimeService realtime,
        IAuditService audit)
    {
        _properties = properties;
        _containment = containment;
        _permissions = permissions;
        _realtime = realtime;
        _audit = audit;
    }

    public async Task<IReadOnlyList<PropertyDto>> ListAsync(OrgMemberContext member, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var scope = await _permissions.ScopePropertyIdsAsync(member, cancellationToken);
        var rows = await _properties.ListAsync(member.OrganizationId, scope, cancellationToken);
        return [.. rows.Select(row => row.ToDto())];
    }

    public async Task<PropertyDto> GetAsync(OrgMemberContext member, string id, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var scope = await _permissions.ScopePropertyIdsAsync(member, cancellationToken);
        var row = await _properties.FindAsync(member.OrganizationId, id, scope, cancellationToken)
            ?? throw InventoryErrors.PropertyNotFound();
        return row.ToDto();
    }

    public async Task<PropertyDto> CreateAsync(
        OrgMemberContext member,
        CreatePropertyRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(request);
        var organizationId = member.OrganizationId;
        // Top-level SITE is OWNER-only ("__root__" is never in any admin's scope).
        await _permissions.AssertCanConfigureAsync(member, request.ParentId ?? "__root__", cancellationToken);

        var type = PropertyTypeLabels.TryParse(request.Type)!.Value;
        var parentType = await ResolveParentTypeAsync(organizationId, request.ParentId, cancellationToken);
        PropertyNesting.AssertValidNesting(parentType, type);
        if (await _properties.SiblingNameExistsAsync(organizationId, request.ParentId, request.Name!, null, cancellationToken))
        {
            throw InventoryErrors.PropertyNameTaken();
        }

        var created = await _properties.CreateAsync(
            new NewProperty(organizationId, request.ParentId, type, request.Name!, request.Code),
            cancellationToken);
        await _realtime.EmitScopedAsync(
            organizationId, created.Id, WsEvents.PropertyCreated, TimestampedId(created.Id), cancellationToken);
        await _audit.RecordCreateAsync(organizationId, "Property", created.Id, created.ToDto(), cancellationToken);
        return created.ToDto();
    }

    public async Task<PropertyDto> UpdateAsync(
        OrgMemberContext member,
        string id,
        ChangesetRequest patch,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(patch);
        var organizationId = member.OrganizationId;
        // Write path: org-wide lookup (no scope) so an out-of-scope ADMIN gets PERM_001, not 404.
        var current = await _properties.FindAsync(organizationId, id, null, cancellationToken)
            ?? throw InventoryErrors.PropertyNotFound();
        await _permissions.AssertCanConfigureAsync(member, current.Id, cancellationToken);

        var parentChange = patch.Changes?.FirstOrDefault(change => change.Field == "parentId");
        var nameChange = patch.Changes?.FirstOrDefault(change => change.Field == "name");
        var nextParentId = parentChange is null
            ? current.ParentId
            : ChangesetValues.AsString(parentChange.NewValue);

        if (parentChange is not null)
        {
            await _permissions.AssertCanConfigureAsync(member, nextParentId ?? "__root__", cancellationToken);
            if (nextParentId is not null
                && await _properties.IsAtOrUnderAsync(organizationId, nextParentId, id, cancellationToken))
            {
                throw InventoryErrors.PropertyCycle();
            }

            var newParentType = await ResolveParentTypeAsync(organizationId, nextParentId, cancellationToken);
            PropertyNesting.AssertValidNesting(newParentType, current.Type);
            await _containment.AssertReparentKeepsContainmentAsync(organizationId, id, nextParentId, cancellationToken);
        }

        if (nameChange is not null || parentChange is not null)
        {
            var nextName = nameChange is null ? current.Name : ChangesetValues.AsString(nameChange.NewValue) ?? "";
            if (await _properties.SiblingNameExistsAsync(organizationId, nextParentId, nextName, id, cancellationToken))
            {
                throw InventoryErrors.PropertyNameTaken();
            }
        }

        var payload = Changesets.BuildUpdatePayload(patch, PropertyFields.Writable, current.Version, PropertyFields.IsValid);
        var updated = await _properties.UpdateWithVersionAsync(
            organizationId, id, payload, patch.BaseVersion!.Value, cancellationToken)
            ?? throw Changesets.EditConflict();

        if (parentChange is not null)
        {
            string[] sites = current.ParentId is null ? [id] : [id, current.ParentId];
            await _realtime.EmitScopedMultiAsync(
                organizationId, sites, WsEvents.PropertyMoved, TimestampedId(id), cancellationToken);
        }
        else
        {
            await _realtime.EmitScopedAsync(
                organizationId, id, WsEvents.PropertyUpdated, TimestampedId(id), cancellationToken);
        }

        await _audit.RecordUpdateAsync(
            organizationId, "Property", id, ChangesetAudit.ToFieldChanges(patch), cancellationToken);
        return updated.ToDto();
    }

    public async Task DeleteAsync(OrgMemberContext member, string id, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var organizationId = member.OrganizationId;
        var property = await _properties.FindAsync(organizationId, id, null, cancellationToken)
            ?? throw InventoryErrors.PropertyNotFound();
        await _permissions.AssertCanConfigureAsync(member, property.Id, cancellationToken);

        var subtreeIds = await _properties.SubtreeIdsAsync(organizationId, id, cancellationToken);
        var hasChildren = subtreeIds.Count > 1;
        var devices = await _properties.CountDevicesUnderAsync(organizationId, subtreeIds, cancellationToken);
        var charters = await _properties.CountChartersUnderAsync(organizationId, subtreeIds, cancellationToken);
        if (hasChildren || devices > 0 || charters > 0)
        {
            throw InventoryErrors.PropertyNotEmpty();
        }

        if (await _properties.CountBuildingModelsUnderAsync(organizationId, subtreeIds, cancellationToken) > 0)
        {
            throw InventoryErrors.BuildingHasModel();
        }

        if (await _properties.CountAssignmentsUnderAsync(organizationId, subtreeIds, cancellationToken) > 0)
        {
            throw InventoryErrors.PropertyAssigned();
        }

        // Emit before the delete so scope resolution can still see the row.
        await _realtime.EmitScopedAsync(
            organizationId, id, WsEvents.PropertyDeleted, TimestampedId(id), cancellationToken);
        await _properties.DeleteAsync(organizationId, id, cancellationToken);
        await _audit.RecordDeleteAsync(organizationId, "Property", id, property.ToDto(), cancellationToken);
    }

    private async Task<PropertyType?> ResolveParentTypeAsync(
        string organizationId,
        string? parentId,
        CancellationToken cancellationToken)
    {
        if (parentId is null)
        {
            return null;
        }

        // Internal call, unscoped: nesting validation must see the full org tree.
        var parent = await _properties.FindAsync(organizationId, parentId, null, cancellationToken)
            ?? throw InventoryErrors.PropertyNotFound();
        return parent.Type;
    }

    private static object TimestampedId(string id) => new { id, timestamp = IsoTimestamp.Now() };
}
