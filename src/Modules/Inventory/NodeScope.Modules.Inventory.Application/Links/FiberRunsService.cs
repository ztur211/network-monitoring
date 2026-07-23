using NodeScope.Contracts.Realtime;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Links;

/// <summary>Fiber-run CRUD, ported from Node's <c>FiberRunsService</c>.</summary>
public sealed class FiberRunsService
{
    private readonly IFiberRunRepository _fiberRuns;
    private readonly LinkEndpoints _endpoints;
    private readonly IPermissionScopeService _permissions;
    private readonly IRealtimeService _realtime;
    private readonly IAuditService _audit;

    public FiberRunsService(
        IFiberRunRepository fiberRuns,
        LinkEndpoints endpoints,
        IPermissionScopeService permissions,
        IRealtimeService realtime,
        IAuditService audit)
    {
        _fiberRuns = fiberRuns;
        _endpoints = endpoints;
        _permissions = permissions;
        _realtime = realtime;
        _audit = audit;
    }

    public async Task<LinkListDto<FiberRunDto>> ListAsync(
        OrgMemberContext member,
        string? deviceId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        // A raw query param: Express parses `?deviceId[]=a&deviceId[]=b` into an array, which
        // would otherwise reach the database as an invalid scalar filter and 500.
        if (deviceId is not null && !Guid.TryParse(deviceId, out _))
        {
            throw new ApiException("GEN_001", "INVALID_DEVICE_ID", 400);
        }

        var scope = await _permissions.ScopePropertyIdsAsync(member, cancellationToken);
        var items = await _fiberRuns.ListVisibleAsync(member.OrganizationId, scope, deviceId, cancellationToken);
        return new LinkListDto<FiberRunDto>([.. items.Select(run => run.ToDto())], items.Count);
    }

    public async Task<FiberRunDto> CreateAsync(
        OrgMemberContext member,
        string creatorUserId,
        CreateFiberRunRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(request);
        if (request.StartDeviceId == request.EndDeviceId)
        {
            throw InventoryErrors.FiberRunSameDevice();
        }

        var organizationId = member.OrganizationId;
        await _endpoints.AuthorizeBothAsync(
            member, request.StartDeviceId!, request.EndDeviceId!, cancellationToken);

        var run = await _fiberRuns.CreateAsync(
            new NewFiberRun(
                organizationId,
                creatorUserId,
                request.TrimmedName!,
                request.StartDeviceId!,
                request.EndDeviceId!,
                request.TrimmedCableType,
                request.LengthMeters,
                request.Notes),
            cancellationToken);
        var dto = run.ToDto();
        await _audit.RecordCreateAsync(organizationId, "FiberRun", run.Id, dto, cancellationToken);
        return dto;
    }

    public async Task<FiberRunDto> GetAsync(
        OrgMemberContext member,
        string fiberRunId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var scope = await _permissions.ScopePropertyIdsAsync(member, cancellationToken);
        var run = await _fiberRuns.FindVisibleAsync(member.OrganizationId, fiberRunId, scope, cancellationToken)
            ?? throw InventoryErrors.FiberRunNotFound();
        return run.ToDto();
    }

    public async Task<FiberRunDto> UpdateAsync(
        OrgMemberContext member,
        string fiberRunId,
        ChangesetRequest patch,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(patch);
        var organizationId = member.OrganizationId;
        // Write path: org-wide lookup so an out-of-scope ADMIN gets PERM_001, not 404.
        var run = await _fiberRuns.FindAsync(organizationId, fiberRunId, cancellationToken)
            ?? throw InventoryErrors.FiberRunNotFound();
        var sites = await _endpoints.AuthorizeBothAsync(
            member, run.StartDeviceId, run.EndDeviceId, cancellationToken);

        var payload = Changesets.BuildUpdatePayload(patch, FiberRunFields.Writable, run.Version, FiberRunFields.IsValid);
        var updated = await _fiberRuns.UpdateWithVersionAsync(
            organizationId, fiberRunId, payload, patch.BaseVersion!.Value, cancellationToken)
            ?? throw Changesets.EditConflict();

        var dto = updated.ToDto();
        await _audit.RecordUpdateAsync(
            organizationId, "FiberRun", fiberRunId, ChangesetAudit.ToFieldChanges(patch), cancellationToken);
        await _realtime.EmitScopedMultiAsync(
            organizationId,
            [sites.First, sites.Second],
            WsEvents.FiberRunUpdated,
            new
            {
                fiberRunId,
                fiberRun = dto,
                changes = patch.Changes,
                updatedBy = updated.UserId ?? "",
                timestamp = IsoTimestamp.Now(),
            },
            cancellationToken);
        return dto;
    }

    public async Task DeleteAsync(OrgMemberContext member, string fiberRunId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        var organizationId = member.OrganizationId;
        var run = await _fiberRuns.FindAsync(organizationId, fiberRunId, cancellationToken)
            ?? throw InventoryErrors.FiberRunNotFound();
        var sites = await _endpoints.AuthorizeBothAsync(
            member, run.StartDeviceId, run.EndDeviceId, cancellationToken);

        await _fiberRuns.DeleteAsync(organizationId, fiberRunId, cancellationToken);
        await _audit.RecordDeleteAsync(organizationId, "FiberRun", fiberRunId, run.ToDto(), cancellationToken);
        await _realtime.EmitScopedMultiAsync(
            organizationId,
            [sites.First, sites.Second],
            WsEvents.FiberRunDeleted,
            new { fiberRunId, timestamp = IsoTimestamp.Now() },
            cancellationToken);
    }
}
