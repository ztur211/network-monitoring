using System.Globalization;
using NodeScope.Modules.Inventory.Application.Devices;
using NodeScope.Modules.Inventory.Application.Links;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Map;

/// <summary>A parsed <c>?bbox=west,south,east,north</c> envelope.</summary>
public sealed record Bbox(double West, double South, double East, double North);

/// <summary>The map list shape - <c>{ items }</c>, with no total.</summary>
public sealed record MapItemsDto<T>(IReadOnlyList<T> Items);

/// <summary>Map viewport reads, ported from Node's <c>MapService</c>.</summary>
public sealed class MapService
{
    private readonly IMapRepository _map;
    private readonly IPermissionScopeService _permissions;

    public MapService(IMapRepository map, IPermissionScopeService permissions)
    {
        _map = map;
        _permissions = permissions;
    }

    public async Task<MapItemsDto<DeviceDto>> DevicesAsync(
        OrgMemberContext member,
        string? bbox,
        int? floor,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var envelope = ParseBbox(bbox);
        var scope = await _permissions.ScopePropertyIdsAsync(member, cancellationToken);
        var devices = await _map.DevicesInBboxAsync(
            member.OrganizationId, envelope, floor, scope, cancellationToken);
        return new MapItemsDto<DeviceDto>([.. devices.Select(device => device.ToDto())]);
    }

    public async Task<MapItemsDto<FiberRunDto>> FiberRunsAsync(
        OrgMemberContext member,
        string? bbox,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var envelope = ParseBbox(bbox);
        var scope = await _permissions.ScopePropertyIdsAsync(member, cancellationToken);
        var runs = await _map.FiberRunsInBboxAsync(member.OrganizationId, envelope, scope, cancellationToken);
        return new MapItemsDto<FiberRunDto>([.. runs.Select(run => run.ToDto())]);
    }

    public async Task<MapItemsDto<CircuitDto>> CircuitsAsync(
        OrgMemberContext member,
        string? bbox,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var envelope = ParseBbox(bbox);
        var scope = await _permissions.ScopePropertyIdsAsync(member, cancellationToken);
        var circuits = await _map.CircuitsInBboxAsync(member.OrganizationId, envelope, scope, cancellationToken);
        return new MapItemsDto<CircuitDto>([.. circuits.Select(circuit => circuit.ToDto())]);
    }

    /// <summary>
    /// Parses and range-checks the envelope. Both a malformed string and an out-of-range
    /// coordinate are <c>GEN_001</c>, matching the Node DTO regex plus the service's own check.
    /// </summary>
    private static Bbox ParseBbox(string? bbox)
    {
        var parts = (bbox ?? "").Split(',');
        if (parts.Length != 4)
        {
            throw MalformedBbox();
        }

        var coords = new double[4];
        for (var i = 0; i < 4; i++)
        {
            if (!double.TryParse(parts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out coords[i]))
            {
                throw MalformedBbox();
            }
        }

        var envelope = new Bbox(coords[0], coords[1], coords[2], coords[3]);
        if (envelope.West is < -180 or > 180 || envelope.East is < -180 or > 180)
        {
            throw new ApiException("GEN_001", "Longitude out of range", 400);
        }

        if (envelope.South is < -90 or > 90 || envelope.North is < -90 or > 90)
        {
            throw new ApiException("GEN_001", "Latitude out of range", 400);
        }

        return envelope;
    }

    private static ApiException MalformedBbox() => ApiErrors.Validation(
        ["bbox must be in format west,south,east,north (four comma-separated floats)"]);
}

/// <summary>The PostGIS viewport queries (Node's <c>MapRepository</c>).</summary>
public interface IMapRepository
{
    /// <summary>Devices whose derived point falls inside the envelope, newest first.</summary>
    public Task<IReadOnlyList<DeviceRecord>> DevicesInBboxAsync(
        string organizationId,
        Bbox bbox,
        int? floor,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken);

    /// <summary>Fiber runs with EITHER endpoint device inside the envelope.</summary>
    public Task<IReadOnlyList<FiberRunRecord>> FiberRunsInBboxAsync(
        string organizationId,
        Bbox bbox,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken);

    /// <summary>Circuits whose linked device is inside the envelope.</summary>
    public Task<IReadOnlyList<CircuitRecord>> CircuitsInBboxAsync(
        string organizationId,
        Bbox bbox,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken);
}
