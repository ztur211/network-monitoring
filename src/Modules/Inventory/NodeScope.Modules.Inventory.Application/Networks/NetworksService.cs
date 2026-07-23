using System.Text.Json;
using NodeScope.Contracts.Realtime;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Networks;

/// <summary>Network CRUD, ported from Node's <c>NetworksService</c>.</summary>
public sealed class NetworksService
{
    private const int MaxNetworksPerOrg = 1;

    private readonly INetworkRepository _networks;
    private readonly IPermissionScopeService _permissions;
    private readonly IRealtimeService _realtime;
    private readonly IAuditService _audit;

    public NetworksService(
        INetworkRepository networks,
        IPermissionScopeService permissions,
        IRealtimeService realtime,
        IAuditService audit)
    {
        _networks = networks;
        _permissions = permissions;
        _realtime = realtime;
        _audit = audit;
    }

    public async Task<IReadOnlyList<NetworkSummaryDto>> ListAsync(
        OrgMemberContext member,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var scope = await _permissions.ScopePropertyIdsAsync(member, cancellationToken);
        var networks = await _networks.ListVisibleAsync(member.OrganizationId, scope, cancellationToken);
        return [.. networks.Select(network => network.ToSummary())];
    }

    public async Task<NetworkDetailDto> CreateAsync(
        OrgMemberContext member,
        string creatorUserId,
        CreateNetworkRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(request);
        // No charters yet on create - just the role gate.
        await _permissions.AssertNetworkFullCoverageAsync(member, [], cancellationToken);
        var organizationId = member.OrganizationId;

        if (await _networks.CountByOrgAsync(organizationId, cancellationToken) >= MaxNetworksPerOrg)
        {
            throw InventoryErrors.NetworkLimitExceeded();
        }

        var network = await _networks.CreateAsync(
            new NewNetwork(
                organizationId,
                creatorUserId,
                request.TrimmedName!,
                request.HomeAddress,
                request.HomeLatitude,
                request.HomeLongitude,
                request.HomePublicIp,
                request.Isp,
                request.DownMbps,
                request.UpMbps),
            cancellationToken);
        var detail = network.ToDetail();
        await _audit.RecordCreateAsync(organizationId, "Network", network.Id, detail, cancellationToken);
        // No charters yet on create means an OWNER-only fan-out.
        await _realtime.EmitScopedMultiAsync(
            organizationId,
            [],
            WsEvents.NetworkUpdated,
            new { networkId = network.Id, network = detail, timestamp = IsoTimestamp.Now() },
            cancellationToken);
        return detail;
    }

    public async Task<NetworkDetailDto> GetAsync(
        OrgMemberContext member,
        string networkId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var scope = await _permissions.ScopePropertyIdsAsync(member, cancellationToken);
        var network = await _networks.FindVisibleAsync(member.OrganizationId, networkId, scope, cancellationToken)
            ?? throw InventoryErrors.NetworkNotFound();
        return network.ToDetail();
    }

    public async Task<NetworkDetailDto> UpdateAsync(
        OrgMemberContext member,
        string networkId,
        ChangesetRequest patch,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(patch);
        var organizationId = member.OrganizationId;
        // Write path: org-wide lookup so an out-of-scope ADMIN gets PERM_004, not 404.
        var network = await _networks.FindAsync(organizationId, networkId, cancellationToken)
            ?? throw InventoryErrors.NetworkNotFound();
        await _permissions.AssertNetworkFullCoverageAsync(
            member, await CoverageSitesAsync(organizationId, networkId, cancellationToken), cancellationToken);

        var payload = Changesets.BuildUpdatePayload(patch, NetworkFields.Writable, network.Version, NetworkFields.IsValid);
        var updated = await _networks.UpdateWithVersionAsync(
            organizationId, networkId, payload, patch.BaseVersion!.Value, cancellationToken)
            ?? throw Changesets.EditConflict();

        var detail = updated.ToDetail();
        await _audit.RecordUpdateAsync(
            organizationId, "Network", networkId, ChangesetAudit.ToFieldChanges(patch), cancellationToken);
        var charterSites = await _networks.CharteredPropertyIdsAsync(organizationId, networkId, cancellationToken);
        await _realtime.EmitScopedMultiAsync(
            organizationId,
            charterSites,
            WsEvents.NetworkUpdated,
            new
            {
                networkId,
                network = detail,
                changes = patch.Changes,
                updatedBy = updated.UserId ?? "",
                timestamp = IsoTimestamp.Now(),
            },
            cancellationToken);

        if (patch.Changes!.Any(change => change.Field == "homePublicIp"))
        {
            await _realtime.RecomputeOnHomeForUserAsync(updated.UserId ?? "", cancellationToken);
        }

        return detail;
    }

    public async Task<NetworkDetailDto> SetHomeIpAsync(
        OrgMemberContext member,
        string networkId,
        string requestIp,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var network = await _networks.FindAsync(member.OrganizationId, networkId, cancellationToken)
            ?? throw InventoryErrors.NetworkNotFound();
        using var newValue = JsonDocument.Parse(JsonSerializer.Serialize(requestIp));
        using var oldValue = JsonDocument.Parse(JsonSerializer.Serialize(network.HomePublicIp));
        return await UpdateAsync(
            member,
            networkId,
            new ChangesetRequest
            {
                BaseVersion = network.Version,
                Changes =
                [
                    new ChangesetChange
                    {
                        Field = "homePublicIp",
                        OldValue = oldValue.RootElement.Clone(),
                        NewValue = newValue.RootElement.Clone(),
                    },
                ],
            },
            cancellationToken);
    }

    public async Task DeleteAsync(OrgMemberContext member, string networkId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var organizationId = member.OrganizationId;
        var network = await _networks.FindAsync(organizationId, networkId, cancellationToken)
            ?? throw InventoryErrors.NetworkNotFound();
        await _permissions.AssertNetworkFullCoverageAsync(
            member, await CoverageSitesAsync(organizationId, networkId, cancellationToken), cancellationToken);
        await _networks.DeleteAsync(organizationId, networkId, cancellationToken);
        await _audit.RecordDeleteAsync(organizationId, "Network", networkId, network.ToDetail(), cancellationToken);
    }

    private async Task<IReadOnlyList<string>> CoverageSitesAsync(
        string organizationId,
        string networkId,
        CancellationToken cancellationToken) =>
        (await _networks.CharteredPropertyIdsAsync(organizationId, networkId, cancellationToken))
            .Union(
                await _networks.DeviceFootprintPropertyIdsAsync(organizationId, networkId, cancellationToken),
                StringComparer.Ordinal)
            .ToList();
}
