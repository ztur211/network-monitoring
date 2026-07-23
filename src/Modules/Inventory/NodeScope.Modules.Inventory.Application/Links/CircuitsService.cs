using System.Text;
using System.Text.Json;
using NodeScope.Contracts.Realtime;
using NodeScope.Modules.Inventory.Application.Devices;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Links;

/// <summary>Circuit CRUD, ported from Node's <c>CircuitsService</c>.</summary>
public sealed class CircuitsService
{
    private const int DefaultLimit = 50;

    /// <summary>
    /// Governing site of a device-less circuit. It is never inside any member's subtree, so such
    /// circuits are OWNER-only for both reads and writes.
    /// </summary>
    private const string NoSite = "__nosite__";

    private readonly ICircuitRepository _circuits;
    private readonly IDeviceRepository _devices;
    private readonly IPermissionScopeService _permissions;
    private readonly IRealtimeService _realtime;
    private readonly IAuditService _audit;

    public CircuitsService(
        ICircuitRepository circuits,
        IDeviceRepository devices,
        IPermissionScopeService permissions,
        IRealtimeService realtime,
        IAuditService audit)
    {
        _circuits = circuits;
        _devices = devices;
        _permissions = permissions;
        _realtime = realtime;
        _audit = audit;
    }

    public async Task<CircuitPageDto> ListAsync(
        OrgMemberContext member,
        int? limit,
        string? cursor,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        if (limit is < 1 or > 100)
        {
            throw ApiErrors.Validation(["limit must not be greater than 100"]);
        }

        var scope = await _permissions.ScopePropertyIdsAsync(member, cancellationToken);
        var pageSize = limit ?? DefaultLimit;
        // One extra row answers "is there a next page" without a second count query.
        var items = await _circuits.ListPageAsync(
            member.OrganizationId, scope, pageSize + 1, DecodeCursor(cursor), cancellationToken);
        var total = await _circuits.CountAsync(member.OrganizationId, scope, cancellationToken);

        var hasMore = items.Count > pageSize;
        var page = hasMore ? items.Take(pageSize).ToList() : items;
        var nextCursor = hasMore ? EncodeCursor(page[^1].CreatedAt, page[^1].Id) : null;
        return new CircuitPageDto([.. page.Select(circuit => circuit.ToDto())], nextCursor, total);
    }

    public async Task<CircuitDto> CreateAsync(
        OrgMemberContext member,
        string creatorUserId,
        CreateCircuitRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(request);
        var organizationId = member.OrganizationId;
        var governingSite = await GoverningSiteAsync(organizationId, request.DeviceId, cancellationToken);
        await _permissions.AssertCanConfigureAsync(member, governingSite, cancellationToken);

        var circuit = await _circuits.CreateAsync(
            new NewCircuit(
                organizationId,
                creatorUserId,
                request.TrimmedIspName!,
                request.TrimmedCircuitId,
                request.TrimmedServiceType!,
                request.Bandwidth,
                request.DeviceId,
                request.Notes),
            cancellationToken);
        var dto = circuit.ToDto();
        await _audit.RecordCreateAsync(organizationId, "Circuit", circuit.Id, dto, cancellationToken);
        return dto;
    }

    public async Task<CircuitDto> GetAsync(
        OrgMemberContext member,
        string circuitId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var scope = await _permissions.ScopePropertyIdsAsync(member, cancellationToken);
        var circuit = await _circuits.FindVisibleAsync(member.OrganizationId, circuitId, scope, cancellationToken)
            ?? throw InventoryErrors.CircuitNotFound();
        return circuit.ToDto();
    }

    public async Task<CircuitDto> UpdateAsync(
        OrgMemberContext member,
        string circuitId,
        ChangesetRequest patch,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(patch);
        var organizationId = member.OrganizationId;
        // Write path: org-wide lookup so an out-of-scope ADMIN gets PERM_001, not 404.
        var circuit = await _circuits.FindAsync(organizationId, circuitId, cancellationToken)
            ?? throw InventoryErrors.CircuitNotFound();
        await _permissions.AssertCanConfigureAsync(
            member, await GoverningSiteAsync(organizationId, circuit.DeviceId, cancellationToken), cancellationToken);

        var payload = Changesets.BuildUpdatePayload(patch, CircuitFields.Writable, circuit.Version, CircuitFields.IsValid);
        if (payload.TryGetValue("deviceId", out var deviceValue))
        {
            var nextDeviceId = ChangesetValues.AsString(deviceValue);
            if (nextDeviceId is not null && nextDeviceId != circuit.DeviceId)
            {
                await _permissions.AssertCanConfigureAsync(
                    member,
                    await GoverningSiteAsync(organizationId, nextDeviceId, cancellationToken),
                    cancellationToken);
            }
        }

        var updated = await _circuits.UpdateWithVersionAsync(
            organizationId, circuitId, payload, patch.BaseVersion!.Value, cancellationToken)
            ?? throw Changesets.EditConflict();

        var dto = updated.ToDto();
        await _audit.RecordUpdateAsync(
            organizationId, "Circuit", circuitId, ChangesetAudit.ToFieldChanges(patch), cancellationToken);
        await _realtime.EmitScopedAsync(
            organizationId,
            await GoverningSiteAsync(organizationId, updated.DeviceId, cancellationToken),
            WsEvents.CircuitUpdated,
            new
            {
                circuitId,
                circuit = dto,
                changes = patch.Changes,
                updatedBy = updated.UserId ?? "",
                timestamp = IsoTimestamp.Now(),
            },
            cancellationToken);
        return dto;
    }

    public async Task DeleteAsync(OrgMemberContext member, string circuitId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var organizationId = member.OrganizationId;
        var circuit = await _circuits.FindAsync(organizationId, circuitId, cancellationToken)
            ?? throw InventoryErrors.CircuitNotFound();
        var site = await GoverningSiteAsync(organizationId, circuit.DeviceId, cancellationToken);
        await _permissions.AssertCanConfigureAsync(member, site, cancellationToken);

        await _circuits.DeleteAsync(organizationId, circuitId, cancellationToken);
        await _audit.RecordDeleteAsync(organizationId, "Circuit", circuitId, circuit.ToDto(), cancellationToken);
        await _realtime.EmitScopedAsync(
            organizationId,
            site,
            WsEvents.CircuitDeleted,
            new { circuitId, timestamp = IsoTimestamp.Now() },
            cancellationToken);
    }

    /// <summary>
    /// The linked device's site, or <see cref="NoSite"/> when the circuit has no device. Doubles
    /// as the device-exists check (<c>DEVICE_001</c>) whenever a device id is given.
    /// </summary>
    private async Task<string> GoverningSiteAsync(
        string organizationId,
        string? deviceId,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(deviceId))
        {
            return NoSite;
        }

        var device = await _devices.FindAsync(organizationId, deviceId, null, cancellationToken)
            ?? throw InventoryErrors.DeviceNotFound();
        return device.PropertyId;
    }

    private static string EncodeCursor(DateTime createdAt, string id) =>
        Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(
            new CircuitCursor(IsoTimestamp.Of(createdAt), id)));

    /// <summary>
    /// The cursor is opaque client input, so a malformed value is a 400, not a 500 out of the
    /// decoder (Node's <c>decodeCursor</c> catch).
    /// </summary>
    private static CircuitCursor? DecodeCursor(string? cursor)
    {
        if (string.IsNullOrEmpty(cursor))
        {
            return null;
        }

        try
        {
            var json = Encoding.UTF8.GetString(Convert.FromBase64String(cursor));
            return JsonSerializer.Deserialize<CircuitCursor>(json)
                ?? throw new ApiException("GEN_001", "INVALID_CURSOR", 400);
        }
        catch (Exception exception) when (exception is FormatException or JsonException or DecoderFallbackException)
        {
            throw new ApiException("GEN_001", "INVALID_CURSOR", 400);
        }
    }
}

/// <summary>The keyset cursor payload: the last row's <c>createdAt</c> and id.</summary>
public sealed record CircuitCursor(string CreatedAt, string Id);
