using System.Text.Json.Serialization;
using NodeScope.Contracts.Realtime;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Properties;

/// <summary>Charter wire DTO: <c>{ id, networkId, propertyId }</c>.</summary>
public sealed record CharterDto(string Id, string NetworkId, string PropertyId);

/// <summary>Body of <c>POST /api/v1/networks/:networkId/properties</c>.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class AddCharterRequest
{
    public string? PropertyId { get; init; }

    public IReadOnlyList<string> Validate() =>
        PropertyId is not null && Guid.TryParse(PropertyId, out _) ? [] : ["propertyId must be a UUID"];
}

/// <summary>Network-to-site charters (Node's <c>NetworkPropertyService</c>).</summary>
public sealed class NetworkPropertyService
{
    private readonly INetworkPropertyRepository _charters;
    private readonly IPropertyRepository _properties;
    private readonly ContainmentService _containment;
    private readonly IPermissionScopeService _permissions;
    private readonly IRealtimeService _realtime;
    private readonly IAuditService _audit;

    public NetworkPropertyService(
        INetworkPropertyRepository charters,
        IPropertyRepository properties,
        ContainmentService containment,
        IPermissionScopeService permissions,
        IRealtimeService realtime,
        IAuditService audit)
    {
        _charters = charters;
        _properties = properties;
        _containment = containment;
        _permissions = permissions;
        _realtime = realtime;
        _audit = audit;
    }

    public async Task<IReadOnlyList<CharterDto>> ListAsync(
        OrgMemberContext member,
        string networkId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var scope = await _permissions.ScopePropertyIdsAsync(member, cancellationToken);
        var charters = await _charters.ListByNetworkAsync(member.OrganizationId, networkId, cancellationToken);
        var visible = scope is null
            ? charters
            : [.. charters.Where(charter => scope.Contains(charter.PropertyId, StringComparer.Ordinal))];
        return [.. visible.Select(charter => new CharterDto(charter.Id, charter.NetworkId, charter.PropertyId))];
    }

    public async Task<CharterDto> AddAsync(
        OrgMemberContext member,
        string networkId,
        string propertyId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var organizationId = member.OrganizationId;
        await _permissions.AssertNetworkFullCoverageAsync(
            member, await CoverageSitesAsync(organizationId, networkId, cancellationToken), cancellationToken);
        await _permissions.AssertCanConfigureAsync(member, propertyId, cancellationToken);
        _ = await _properties.FindAsync(organizationId, propertyId, null, cancellationToken)
            ?? throw InventoryErrors.PropertyNotFound();
        if (await _charters.CharterExistsAsync(organizationId, networkId, propertyId, cancellationToken))
        {
            throw InventoryErrors.CharterExists();
        }

        var created = await _charters.CreateAsync(organizationId, networkId, propertyId, cancellationToken);

        // Include the newly-added site in the fan-out so its members learn about the charter.
        var allSites = (await _charters.PropertyIdsByNetworkAsync(organizationId, networkId, cancellationToken))
            .Union([propertyId], StringComparer.Ordinal)
            .ToList();
        await _realtime.EmitScopedMultiAsync(
            organizationId,
            allSites,
            WsEvents.NetworkCharterAdded,
            new { id = created.Id, networkId, propertyId, timestamp = IsoTimestamp.Now() },
            cancellationToken);
        var dto = new CharterDto(created.Id, networkId, propertyId);
        await _audit.RecordCreateAsync(organizationId, "NetworkProperty", created.Id, dto, cancellationToken);
        return dto;
    }

    public async Task RemoveAsync(
        OrgMemberContext member,
        string networkId,
        string propertyId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var organizationId = member.OrganizationId;
        await _permissions.AssertNetworkFullCoverageAsync(
            member, await CoverageSitesAsync(organizationId, networkId, cancellationToken), cancellationToken);
        var existing = await _charters.FindCharterAsync(organizationId, networkId, propertyId, cancellationToken)
            ?? throw InventoryErrors.PropertyNotFound();
        await _containment.AssertCharterRemovableAsync(organizationId, networkId, propertyId, cancellationToken);

        // Emit before the delete so the removed charter's site viewers are still included.
        var allSites = (await _charters.PropertyIdsByNetworkAsync(organizationId, networkId, cancellationToken))
            .Union([propertyId], StringComparer.Ordinal)
            .ToList();
        await _realtime.EmitScopedMultiAsync(
            organizationId,
            allSites,
            WsEvents.NetworkCharterRemoved,
            new { networkId, propertyId, timestamp = IsoTimestamp.Now() },
            cancellationToken);
        await _charters.DeleteAsync(organizationId, networkId, propertyId, cancellationToken);
        await _audit.RecordDeleteAsync(
            organizationId,
            "NetworkProperty",
            existing.Id,
            new CharterDto(existing.Id, existing.NetworkId, existing.PropertyId),
            cancellationToken);
    }

    /// <summary>Chartered sites plus the network's device footprint - the F3 coverage set.</summary>
    private async Task<IReadOnlyList<string>> CoverageSitesAsync(
        string organizationId,
        string networkId,
        CancellationToken cancellationToken) =>
        (await _charters.PropertyIdsByNetworkAsync(organizationId, networkId, cancellationToken))
            .Union(
                await _charters.DeviceFootprintPropertyIdsAsync(organizationId, networkId, cancellationToken),
                StringComparer.Ordinal)
            .ToList();
}
