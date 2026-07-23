using NodeScope.Contracts.Realtime;
using NodeScope.Modules.Inventory.Application.Properties;
using NodeScope.Modules.Inventory.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.BuildingModels;

/// <summary>
/// Building-model reads, uploads, activation, and version deletion (Node's
/// <c>BuildingModelsService</c>). Mutations are OWNER/ADMIN-gated at the endpoint; this layer
/// adds the per-site F3 authority, the audit trail, and the <c>v1:buildingModel:*</c> events.
/// </summary>
public sealed class BuildingModelsService
{
    /// <summary>200 MiB, the Node default for <c>MODEL_MAX_BYTES</c>.</summary>
    public const long DefaultMaxBytes = 209_715_200;

    private readonly IBuildingModelRepository _models;
    private readonly IPropertyRepository _properties;
    private readonly IObjectStorage _storage;
    private readonly IPermissionScopeService _permissions;
    private readonly IRealtimeService _realtime;
    private readonly IAuditService _audit;

    public BuildingModelsService(
        IBuildingModelRepository models,
        IPropertyRepository properties,
        IObjectStorage storage,
        IPermissionScopeService permissions,
        IRealtimeService realtime,
        IAuditService audit)
    {
        _models = models;
        _properties = properties;
        _storage = storage;
        _permissions = permissions;
        _realtime = realtime;
        _audit = audit;
    }

    public async Task<BuildingModelDto> GetModelAsync(
        OrgMemberContext member,
        string propertyId,
        CancellationToken cancellationToken)
    {
        await AssertReadableAsync(member, propertyId, cancellationToken);
        var model = await RequireModelAsync(member.OrganizationId, propertyId, cancellationToken);
        return model.ToDto();
    }

    public async Task<IReadOnlyList<BuildingModelVersionDto>> ListVersionsAsync(
        OrgMemberContext member,
        string propertyId,
        CancellationToken cancellationToken)
    {
        await AssertReadableAsync(member, propertyId, cancellationToken);
        var model = await RequireModelAsync(member.OrganizationId, propertyId, cancellationToken);
        var versions = await _models.ListVersionsAsync(member.OrganizationId, model.Id, cancellationToken);
        return [.. versions.Select(version => version.ToDto())];
    }

    /// <summary>
    /// Streams the request body into storage, validating size and the IFC prefix as it flows,
    /// and only then writes the version row: a failed upload must leave neither an orphaned
    /// object nor an empty model.
    /// </summary>
    public async Task<BuildingModelVersionDto> UploadVersionAsync(
        OrgMemberContext member,
        string propertyId,
        string? fileName,
        string? units,
        Stream body,
        long maxBytes,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);

        // The F3 gate runs before any lookup, so an out-of-scope ADMIN learns nothing about the
        // target property and never triggers the expensive upload.
        await _permissions.AssertCanConfigureAsync(member, propertyId, cancellationToken);

        var property = await _properties.FindAsync(member.OrganizationId, propertyId, null, cancellationToken)
            ?? throw InventoryErrors.BuildingModelNotFound();
        if (property.Type != PropertyType.Building)
        {
            throw InventoryErrors.PropertyNotBuilding();
        }

        var versionId = Guid.NewGuid().ToString();
        var key = StorageKeys.BuildingModelVersion(member.OrganizationId, propertyId, versionId);
        string contentHash;
        int sizeBytes;
        await using (var content = new IfcContentStream(body, maxBytes))
        {
            try
            {
                await _storage.PutAsync(key, content, "application/octet-stream", cancellationToken);
            }
            catch (Exception)
            {
                await DeleteQuietlyAsync(key, cancellationToken);
                throw;
            }

            contentHash = content.ContentHash();
            sizeBytes = (int)content.SizeBytes;
        }

        BuildingModelRecord model;
        BuildingModelVersionRecord version;
        try
        {
            model = await _models.FindByPropertyAsync(member.OrganizationId, propertyId, cancellationToken)
                ?? await _models.CreateModelAsync(
                    member.OrganizationId, propertyId, property.Name, cancellationToken);
            var versionNumber = await _models.NextVersionNumberAsync(
                member.OrganizationId, model.Id, cancellationToken);
            version = await _models.CreateVersionAsync(
                new NewBuildingModelVersion(
                    versionId,
                    member.OrganizationId,
                    model.Id,
                    versionNumber,
                    key,
                    string.IsNullOrEmpty(fileName) ? "model.ifc" : fileName,
                    contentHash,
                    sizeBytes,
                    units,
                    member.MemberId),
                cancellationToken);
        }
        catch (Exception)
        {
            // Until the version row exists, nothing in the database owns the landed object.
            await DeleteQuietlyAsync(key, cancellationToken);
            throw;
        }

        await _models.SetActiveVersionAsync(
            member.OrganizationId, model.Id, version.Id, model.Version, cancellationToken);
        await _audit.RecordCreateAsync(
            member.OrganizationId, "BuildingModelVersion", version.Id, version.ToDto(), cancellationToken);
        await _realtime.PushToOrgAsync(
            member.OrganizationId,
            WsEvents.BuildingModelVersionUploaded,
            new { propertyId, versionId = version.Id, versionNumber = version.VersionNumber },
            cancellationToken);
        return version.ToDto();
    }

    public async Task<BuildingModelDto> ActivateVersionAsync(
        OrgMemberContext member,
        string propertyId,
        string versionId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        await _permissions.AssertCanConfigureAsync(member, propertyId, cancellationToken);
        var model = await RequireModelAsync(member.OrganizationId, propertyId, cancellationToken);
        _ = await RequireVersionAsync(member.OrganizationId, model.Id, versionId, cancellationToken);

        if (!await _models.SetActiveVersionAsync(
            member.OrganizationId, model.Id, versionId, model.Version, cancellationToken))
        {
            throw Changesets.EditConflict();
        }

        await _realtime.PushToOrgAsync(
            member.OrganizationId,
            WsEvents.BuildingModelActivated,
            new { propertyId, versionId },
            cancellationToken);
        return (await RequireModelAsync(member.OrganizationId, propertyId, cancellationToken)).ToDto();
    }

    public async Task DeleteVersionAsync(
        OrgMemberContext member,
        string propertyId,
        string versionId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        await _permissions.AssertCanConfigureAsync(member, propertyId, cancellationToken);
        var model = await RequireModelAsync(member.OrganizationId, propertyId, cancellationToken);
        var version = await RequireVersionAsync(member.OrganizationId, model.Id, versionId, cancellationToken);
        if (model.ActiveVersionId == versionId)
        {
            throw InventoryErrors.CannotDeleteActiveVersion();
        }

        await _storage.DeleteAsync(version.StorageKey, cancellationToken);
        await _models.DeleteVersionAsync(member.OrganizationId, versionId, cancellationToken);
        await _audit.RecordDeleteAsync(
            member.OrganizationId, "BuildingModelVersion", versionId, version.ToDto(), cancellationToken);
        await _realtime.PushToOrgAsync(
            member.OrganizationId, WsEvents.BuildingModelDeleted, new { versionId }, cancellationToken);
    }

    public async Task<ModelFile> GetActiveFileAsync(
        OrgMemberContext member,
        string propertyId,
        CancellationToken cancellationToken)
    {
        await AssertReadableAsync(member, propertyId, cancellationToken);
        var model = await RequireModelAsync(member.OrganizationId, propertyId, cancellationToken);
        if (model.ActiveVersionId is null)
        {
            throw InventoryErrors.ModelVersionNotFound();
        }

        var version = await _models.FindVersionAsync(member.OrganizationId, model.ActiveVersionId, cancellationToken)
            ?? throw InventoryErrors.ModelVersionNotFound();
        return await OpenAsync(version, cancellationToken);
    }

    public async Task<ModelFile> GetVersionFileAsync(
        OrgMemberContext member,
        string propertyId,
        string versionId,
        CancellationToken cancellationToken)
    {
        await AssertReadableAsync(member, propertyId, cancellationToken);
        var model = await RequireModelAsync(member.OrganizationId, propertyId, cancellationToken);
        var version = await RequireVersionAsync(member.OrganizationId, model.Id, versionId, cancellationToken);
        return await OpenAsync(version, cancellationToken);
    }

    /// <summary>
    /// Read gate: the building is its own governing site. An out-of-scope read 404s rather than
    /// 403s, so a model's existence never leaks outside the member's scope.
    /// </summary>
    private async Task AssertReadableAsync(
        OrgMemberContext member,
        string propertyId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        if (!await _permissions.IsInScopeAsync(member, propertyId, cancellationToken))
        {
            throw InventoryErrors.BuildingModelNotFound();
        }
    }

    private async Task<BuildingModelRecord> RequireModelAsync(
        string organizationId,
        string propertyId,
        CancellationToken cancellationToken) =>
        await _models.FindByPropertyAsync(organizationId, propertyId, cancellationToken)
        ?? throw InventoryErrors.BuildingModelNotFound();

    private async Task<BuildingModelVersionRecord> RequireVersionAsync(
        string organizationId,
        string modelId,
        string versionId,
        CancellationToken cancellationToken)
    {
        var version = await _models.FindVersionAsync(organizationId, versionId, cancellationToken);
        return version is null || version.BuildingModelId != modelId
            ? throw InventoryErrors.ModelVersionNotFound()
            : version;
    }

    private async Task<ModelFile> OpenAsync(BuildingModelVersionRecord version, CancellationToken cancellationToken) =>
        new(await _storage.GetAsync(version.StorageKey, cancellationToken), version.FileName, version.SizeBytes);

    /// <summary>
    /// Cleanup on a failed upload. Every failure is swallowed on purpose: this runs while an
    /// exception is already in flight, and a storage error here would replace the real cause
    /// with a misleading one. The worst case is one orphaned object.
    /// </summary>
    private async Task DeleteQuietlyAsync(string key, CancellationToken cancellationToken)
    {
#pragma warning disable CA1031
        try
        {
            await _storage.DeleteAsync(key, cancellationToken);
        }
        catch (Exception)
        {
        }
#pragma warning restore CA1031
    }
}
