using NodeScope.Contracts.Realtime;
using NodeScope.Modules.Inventory.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Links;

/// <summary>Device-connection CRUD, ported from Node's <c>ConnectionsService</c>.</summary>
public sealed class ConnectionsService
{
    private readonly IConnectionRepository _connections;
    private readonly LinkEndpoints _endpoints;
    private readonly IPermissionScopeService _permissions;
    private readonly IRealtimeService _realtime;
    private readonly IAuditService _audit;

    public ConnectionsService(
        IConnectionRepository connections,
        LinkEndpoints endpoints,
        IPermissionScopeService permissions,
        IRealtimeService realtime,
        IAuditService audit)
    {
        _connections = connections;
        _endpoints = endpoints;
        _permissions = permissions;
        _realtime = realtime;
        _audit = audit;
    }

    public async Task<LinkListDto<ConnectionDto>> ListAsync(
        OrgMemberContext member,
        string? deviceId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        if (deviceId is not null && !Guid.TryParse(deviceId, out _))
        {
            throw new ApiException("GEN_001", "INVALID_DEVICE_ID", 400);
        }

        var scope = await _permissions.ScopePropertyIdsAsync(member, cancellationToken);
        var items = await _connections.ListVisibleAsync(member.OrganizationId, scope, deviceId, cancellationToken);
        return new LinkListDto<ConnectionDto>([.. items.Select(connection => connection.ToDto())], items.Count);
    }

    public async Task<ConnectionDto> CreateAsync(
        OrgMemberContext member,
        string creatorUserId,
        CreateConnectionRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(request);
        if (request.SourceDeviceId == request.TargetDeviceId)
        {
            throw InventoryErrors.SelfConnection();
        }

        var organizationId = member.OrganizationId;
        await _endpoints.AuthorizeBothAsync(
            member, request.SourceDeviceId!, request.TargetDeviceId!, cancellationToken);

        var connectionType = ConnectionTypeLabels.TryParse(request.ConnectionType)!.Value;
        if (await _connections.DuplicateExistsAsync(
            organizationId, request.SourceDeviceId!, request.TargetDeviceId!, connectionType, cancellationToken))
        {
            throw InventoryErrors.DuplicateConnection();
        }

        var connection = await _connections.CreateAsync(
            new NewConnection(
                organizationId,
                creatorUserId,
                request.SourceDeviceId!,
                request.TargetDeviceId!,
                connectionType,
                request.Notes),
            cancellationToken);
        var dto = connection.ToDto();
        await _audit.RecordCreateAsync(organizationId, "DeviceConnection", connection.Id, dto, cancellationToken);
        return dto;
    }

    public async Task<ConnectionDto> GetAsync(
        OrgMemberContext member,
        string connectionId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var scope = await _permissions.ScopePropertyIdsAsync(member, cancellationToken);
        var connection = await _connections.FindVisibleAsync(
            member.OrganizationId, connectionId, scope, cancellationToken)
            ?? throw InventoryErrors.ConnectionNotFound();
        return connection.ToDto();
    }

    public async Task<ConnectionDto> UpdateAsync(
        OrgMemberContext member,
        string connectionId,
        ChangesetRequest patch,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(patch);
        var organizationId = member.OrganizationId;
        // Write path: org-wide lookup so an out-of-scope ADMIN gets PERM_001, not 404.
        var connection = await _connections.FindAsync(organizationId, connectionId, cancellationToken)
            ?? throw InventoryErrors.ConnectionNotFound();
        var sites = await _endpoints.AuthorizeBothAsync(
            member, connection.SourceDeviceId, connection.TargetDeviceId, cancellationToken);

        var payload = Changesets.BuildUpdatePayload(
            patch, ConnectionFields.Writable, connection.Version, ConnectionFields.IsValid);
        var updated = await _connections.UpdateWithVersionAsync(
            organizationId, connectionId, payload, patch.BaseVersion!.Value, cancellationToken)
            ?? throw Changesets.EditConflict();

        var dto = updated.ToDto();
        await _audit.RecordUpdateAsync(
            organizationId, "DeviceConnection", connectionId, ChangesetAudit.ToFieldChanges(patch), cancellationToken);
        await _realtime.EmitScopedMultiAsync(
            organizationId,
            [sites.First, sites.Second],
            WsEvents.ConnectionUpdated,
            new
            {
                connectionId,
                connection = dto,
                changes = patch.Changes,
                updatedBy = updated.UserId ?? "",
                timestamp = IsoTimestamp.Now(),
            },
            cancellationToken);
        return dto;
    }

    public async Task DeleteAsync(OrgMemberContext member, string connectionId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var organizationId = member.OrganizationId;
        var connection = await _connections.FindAsync(organizationId, connectionId, cancellationToken)
            ?? throw InventoryErrors.ConnectionNotFound();
        var sites = await _endpoints.AuthorizeBothAsync(
            member, connection.SourceDeviceId, connection.TargetDeviceId, cancellationToken);

        await _connections.DeleteAsync(organizationId, connectionId, cancellationToken);
        await _audit.RecordDeleteAsync(
            organizationId, "DeviceConnection", connectionId, connection.ToDto(), cancellationToken);
        await _realtime.EmitScopedMultiAsync(
            organizationId,
            [sites.First, sites.Second],
            WsEvents.ConnectionDeleted,
            new { connectionId, timestamp = IsoTimestamp.Now() },
            cancellationToken);
    }
}
