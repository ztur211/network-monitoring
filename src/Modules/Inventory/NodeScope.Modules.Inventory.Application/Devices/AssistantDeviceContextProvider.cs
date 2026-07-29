using NodeScope.Modules.Inventory.Application.Links;
using NodeScope.Modules.Inventory.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Devices;

/// <summary>
/// Builds assistant context only after the normal F3 scope has filtered the selected
/// device. Connection peers are filtered through the same scope.
/// </summary>
public sealed class AssistantDeviceContextProvider : IAssistantDeviceContextProvider
{
    private const int MaxConnections = 10;
    private readonly IDeviceRepository _devices;
    private readonly IConnectionRepository _connections;
    private readonly IPermissionScopeService _permissions;

    public AssistantDeviceContextProvider(
        IDeviceRepository devices,
        IConnectionRepository connections,
        IPermissionScopeService permissions)
    {
        _devices = devices;
        _connections = connections;
        _permissions = permissions;
    }

    public async Task<AssistantDeviceContext?> FindVisibleAsync(
        OrgMemberContext member,
        string deviceId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var scope = await _permissions.ScopePropertyIdsAsync(member, cancellationToken);
        var device = await _devices.FindAsync(
            member.OrganizationId,
            deviceId,
            scope,
            cancellationToken);
        if (device is null)
        {
            return null;
        }

        var connections = await _connections.ListVisibleAsync(
            member.OrganizationId,
            scope,
            deviceId,
            cancellationToken);
        var peerIds = connections
            .Select(connection => connection.SourceDeviceId == deviceId
                ? connection.TargetDeviceId
                : connection.SourceDeviceId)
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        var peers = await _devices.ListByIdsAsync(
            member.OrganizationId,
            peerIds,
            scope,
            cancellationToken);
        var peerNames = peers.ToDictionary(peer => peer.Id, peer => peer.Name, StringComparer.Ordinal);

        var visibleConnections = connections
            .Select(connection =>
            {
                var peerId = connection.SourceDeviceId == deviceId
                    ? connection.TargetDeviceId
                    : connection.SourceDeviceId;
                return peerNames.TryGetValue(peerId, out var peerName)
                    ? new AssistantDeviceConnection(
                        peerName,
                        ConnectionTypeLabels.Of(connection.ConnectionType))
                    : null;
            })
            .OfType<AssistantDeviceConnection>()
            .Take(MaxConnections)
            .ToArray();

        return new AssistantDeviceContext(
            device.Id,
            device.Name,
            DeviceCategoryLabels.Of(device.Category),
            device.IpAddress,
            device.MacAddress,
            device.Floor,
            device.FloorLabel,
            connections.Count,
            visibleConnections);
    }
}
