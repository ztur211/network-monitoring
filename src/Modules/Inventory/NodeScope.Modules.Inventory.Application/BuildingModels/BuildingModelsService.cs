using System.Security.Cryptography;
using System.Text.Json;
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

    private const int MaxMetadataBytes = 33_554_432;

    private static readonly JsonSerializerOptions MetadataJson =
        new(JsonSerializerDefaults.Web);

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
        bool activate,
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
                await DeleteQuietlyAsync(key);
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
            await DeleteQuietlyAsync(key);
            throw;
        }

        if (activate
            && !await _models.SetActiveVersionAsync(
                member.OrganizationId, model.Id, version.Id, model.Version, cancellationToken))
        {
            throw Changesets.EditConflict();
        }

        await _audit.RecordCreateAsync(
            member.OrganizationId, "BuildingModelVersion", version.Id, version.ToDto(), cancellationToken);
        await _realtime.PushToOrgAsync(
            member.OrganizationId,
            WsEvents.BuildingModelVersionUploaded,
            new { propertyId, versionId = version.Id, versionNumber = version.VersionNumber },
            cancellationToken);
        return version.ToDto();
    }

    /// <summary>
    /// Stores the cross-platform render artifact paired with an immutable IFC version.
    /// The PUT is intentionally idempotent: retrying after a lost response atomically
    /// replaces the same object key with the same derived bytes.
    /// </summary>
    public async Task<BuildingModelGeometryDto> UploadGeometryAsync(
        OrgMemberContext member,
        string propertyId,
        string versionId,
        Stream body,
        long maxBytes,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        await _permissions.AssertCanConfigureAsync(member, propertyId, cancellationToken);
        var model = await RequireModelAsync(member.OrganizationId, propertyId, cancellationToken);
        _ = await RequireVersionAsync(member.OrganizationId, model.Id, versionId, cancellationToken);

        var key = StorageKeys.BuildingModelGeometry(member.OrganizationId, propertyId, versionId);
        string contentHash;
        int sizeBytes;
        await using (var content = new WexBimContentStream(body, maxBytes))
        {
            await _storage.PutAsync(
                key, content, "application/vnd.xbim.wexbim", cancellationToken);
            contentHash = content.ContentHash();
            sizeBytes = checked((int)content.SizeBytes);
        }

        return new BuildingModelGeometryDto(versionId, "WEXBIM", contentHash, sizeBytes);
    }

    public async Task<BuildingModelMetadataReceiptDto> UploadMetadataAsync(
        OrgMemberContext member,
        string propertyId,
        string versionId,
        UploadBuildingModelMetadataRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(request);
        await _permissions.AssertCanConfigureAsync(member, propertyId, cancellationToken);
        var model = await RequireModelAsync(member.OrganizationId, propertyId, cancellationToken);
        _ = await RequireVersionAsync(member.OrganizationId, model.Id, versionId, cancellationToken);
        if (request.Validate().Count > 0 || request.Elements is not { } elements)
        {
            throw InventoryErrors.InvalidModelMetadata();
        }

        var document = new StoredBuildingModelMetadata(
            request.FormatVersion,
            elements);
        var content = JsonSerializer.SerializeToUtf8Bytes(document, MetadataJson);
        if (content.Length > MaxMetadataBytes)
        {
            throw InventoryErrors.InvalidModelMetadata();
        }

        var key = StorageKeys.BuildingModelMetadata(
            member.OrganizationId,
            propertyId,
            versionId);
        using var stream = new MemoryStream(content, writable: false);
        await _storage.PutAsync(
            key,
            stream,
            "application/vnd.nodescope.ifc-elements+json",
            cancellationToken);
        return new BuildingModelMetadataReceiptDto(
            versionId,
            request.FormatVersion,
            Convert.ToHexStringLower(SHA256.HashData(content)),
            content.Length,
            elements.Count);
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

        // Remove the owning row before its objects. A storage outage may leave an
        // unreachable orphan for later garbage collection, but it must never leave
        // a live database version pointing at an IFC that was already deleted.
        await _models.DeleteVersionAsync(member.OrganizationId, versionId, cancellationToken);
        try
        {
            await _audit.RecordDeleteAsync(
                member.OrganizationId, "BuildingModelVersion", versionId, version.ToDto(), cancellationToken);
            await _realtime.PushToOrgAsync(
                member.OrganizationId, WsEvents.BuildingModelDeleted, new { versionId }, cancellationToken);
        }
        finally
        {
            await DeleteQuietlyAsync(version.StorageKey);
            await DeleteQuietlyAsync(
                StorageKeys.BuildingModelGeometry(member.OrganizationId, propertyId, versionId));
            await DeleteQuietlyAsync(
                StorageKeys.BuildingModelMetadata(member.OrganizationId, propertyId, versionId));
        }
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

    public async Task<ModelFile> GetActiveGeometryAsync(
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

        var version = await _models.FindVersionAsync(
            member.OrganizationId, model.ActiveVersionId, cancellationToken)
            ?? throw InventoryErrors.ModelVersionNotFound();
        return await OpenGeometryAsync(member.OrganizationId, propertyId, version, cancellationToken);
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

    public async Task<ModelFile> GetVersionGeometryAsync(
        OrgMemberContext member,
        string propertyId,
        string versionId,
        CancellationToken cancellationToken)
    {
        await AssertReadableAsync(member, propertyId, cancellationToken);
        var model = await RequireModelAsync(member.OrganizationId, propertyId, cancellationToken);
        var version = await RequireVersionAsync(member.OrganizationId, model.Id, versionId, cancellationToken);
        return await OpenGeometryAsync(member.OrganizationId, propertyId, version, cancellationToken);
    }

    public async Task<BuildingModelMetadataDto> GetActiveMetadataAsync(
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

        var version = await _models.FindVersionAsync(
            member.OrganizationId,
            model.ActiveVersionId,
            cancellationToken)
            ?? throw InventoryErrors.ModelVersionNotFound();
        return await ReadMetadataAsync(
            member.OrganizationId,
            propertyId,
            version.Id,
            cancellationToken);
    }

    public async Task<BuildingModelMetadataDto> GetVersionMetadataAsync(
        OrgMemberContext member,
        string propertyId,
        string versionId,
        CancellationToken cancellationToken)
    {
        await AssertReadableAsync(member, propertyId, cancellationToken);
        var model = await RequireModelAsync(member.OrganizationId, propertyId, cancellationToken);
        _ = await RequireVersionAsync(member.OrganizationId, model.Id, versionId, cancellationToken);
        return await ReadMetadataAsync(
            member.OrganizationId,
            propertyId,
            versionId,
            cancellationToken);
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

    private async Task<ModelFile> OpenGeometryAsync(
        string organizationId,
        string propertyId,
        BuildingModelVersionRecord version,
        CancellationToken cancellationToken)
    {
        var key = StorageKeys.BuildingModelGeometry(organizationId, propertyId, version.Id);
        if (!await _storage.ExistsAsync(key, cancellationToken))
        {
            throw InventoryErrors.ModelGeometryNotFound();
        }

        var fileName = $"{Path.GetFileNameWithoutExtension(version.FileName)}.wexbim";
        return new ModelFile(await _storage.GetAsync(key, cancellationToken), fileName, 0);
    }

    private async Task<BuildingModelMetadataDto> ReadMetadataAsync(
        string organizationId,
        string propertyId,
        string versionId,
        CancellationToken cancellationToken)
    {
        var key = StorageKeys.BuildingModelMetadata(organizationId, propertyId, versionId);
        if (!await _storage.ExistsAsync(key, cancellationToken))
        {
            throw InventoryErrors.ModelMetadataNotFound();
        }

        await using var source = await _storage.GetAsync(key, cancellationToken);
        using var content = new MemoryStream();
        var buffer = new byte[81920];
        while (true)
        {
            var read = await source.ReadAsync(buffer, cancellationToken);
            if (read == 0)
            {
                break;
            }

            if (content.Length > MaxMetadataBytes - read)
            {
                throw InventoryErrors.InvalidModelMetadata();
            }

            await content.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
        }

        StoredBuildingModelMetadata? document;
        try
        {
            document = JsonSerializer.Deserialize<StoredBuildingModelMetadata>(
                content.GetBuffer().AsSpan(0, checked((int)content.Length)),
                MetadataJson);
        }
        catch (JsonException)
        {
            throw InventoryErrors.InvalidModelMetadata();
        }

        if (document is null || document.Elements is null)
        {
            throw InventoryErrors.InvalidModelMetadata();
        }

        var validation = new UploadBuildingModelMetadataRequest
        {
            FormatVersion = document.FormatVersion,
            Elements = document.Elements,
        };
        if (validation.Validate().Count > 0)
        {
            throw InventoryErrors.InvalidModelMetadata();
        }

        return new BuildingModelMetadataDto(
            versionId,
            document.FormatVersion,
            document.Elements);
    }

    /// <summary>
    /// Cleanup on a failed upload. Every failure is swallowed on purpose: this runs while an
    /// exception is already in flight, and a storage error here would replace the real cause
    /// with a misleading one. The worst case is one orphaned object.
    /// </summary>
    private async Task DeleteQuietlyAsync(string key)
    {
#pragma warning disable CA1031
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        try
        {
            await _storage.DeleteAsync(key, timeout.Token);
        }
        catch (Exception)
        {
        }
#pragma warning restore CA1031
    }

    private sealed record StoredBuildingModelMetadata(
        int FormatVersion,
        IReadOnlyList<BuildingModelElementDto> Elements);
}
