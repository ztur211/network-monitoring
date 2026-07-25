using System.Text.Json;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Auth;

namespace NodeScope.Desktop.Tests.Fakes;

/// <summary>An in-memory appliance: scripted responses, recorded requests.</summary>
internal sealed class FakeApplianceClient(Uri baseUrl) : IApplianceClient
{
    public Uri BaseUrl { get; } = baseUrl;

    public string TokenToReturn { get; set; } = "session-token-1";

    public CurrentUser UserToReturn { get; set; } = new("user-1", "owner@acme.test", "Owner");

    public Exception? ExchangeFailure { get; set; }

    public Exception? CurrentUserFailure { get; set; }

    public string? LastExchangedCode { get; private set; }

    public string? LastVerifier { get; private set; }

    public string? LastBearerToken { get; private set; }

    public string? RevokedToken { get; private set; }

    public void Dispose()
    {
    }

    public Task<string> ExchangeDesktopCodeAsync(string code, string codeVerifier, CancellationToken cancellationToken)
    {
        LastExchangedCode = code;
        LastVerifier = codeVerifier;
        return ExchangeFailure is null ? Task.FromResult(TokenToReturn) : Task.FromException<string>(ExchangeFailure);
    }

    public Task<CurrentUser> GetCurrentUserAsync(string bearerToken, CancellationToken cancellationToken)
    {
        LastBearerToken = bearerToken;
        return CurrentUserFailure is null
            ? Task.FromResult(UserToReturn)
            : Task.FromException<CurrentUser>(CurrentUserFailure);
    }

    public Task RevokeAsync(string bearerToken, CancellationToken cancellationToken)
    {
        RevokedToken = bearerToken;
        return Task.CompletedTask;
    }

    // --- map surface -------------------------------------------------------

    public bool TilesAvailable { get; set; } = true;

    public List<MapDevice> Devices { get; } = [];

    public List<MapFiberRun> FiberRuns { get; } = [];

    public JsonElement? StoredPreferences { get; set; }

    public Exception? MapFailure { get; set; }

    public List<MapBbox> DeviceBboxRequests { get; } = [];

    public List<int?> FloorRequests { get; } = [];

    public List<MapBbox> FiberBboxRequests { get; } = [];

    public int PreferencesPuts { get; private set; }

    public Task<bool> ProbeTilesAsync(CancellationToken cancellationToken) =>
        Task.FromResult(TilesAvailable);

    public Task<IReadOnlyList<MapDevice>> GetDevicesAsync(string bearerToken, CancellationToken cancellationToken)
    {
        LastBearerToken = bearerToken;
        return MapFailure is null
            ? Task.FromResult<IReadOnlyList<MapDevice>>([.. Devices])
            : Task.FromException<IReadOnlyList<MapDevice>>(MapFailure);
    }

    public Task<IReadOnlyList<MapDevice>> GetMapDevicesAsync(
        string bearerToken, MapBbox bbox, int? floor, CancellationToken cancellationToken)
    {
        DeviceBboxRequests.Add(bbox);
        FloorRequests.Add(floor);
        return MapFailure is null
            ? Task.FromResult<IReadOnlyList<MapDevice>>([.. Devices])
            : Task.FromException<IReadOnlyList<MapDevice>>(MapFailure);
    }

    public Task<IReadOnlyList<MapFiberRun>> GetMapFiberRunsAsync(
        string bearerToken, MapBbox bbox, CancellationToken cancellationToken)
    {
        FiberBboxRequests.Add(bbox);
        return MapFailure is null
            ? Task.FromResult<IReadOnlyList<MapFiberRun>>([.. FiberRuns])
            : Task.FromException<IReadOnlyList<MapFiberRun>>(MapFailure);
    }

    public Task<JsonElement?> GetPreferencesAsync(string bearerToken, CancellationToken cancellationToken) =>
        Task.FromResult(StoredPreferences);

    public Task PutPreferencesAsync(string bearerToken, JsonElement preferences, CancellationToken cancellationToken)
    {
        StoredPreferences = preferences;
        PreferencesPuts++;
        return Task.CompletedTask;
    }

    // --- native BIM surface ----------------------------------------------

    public List<PropertySummary> Properties { get; } = [];

    public Dictionary<string, BuildingModelSummary> BuildingModels { get; } = [];

    public Dictionary<string, byte[]> BuildingGeometry { get; } = [];

    public Dictionary<string, BuildingModelMetadataSummary> BuildingMetadata { get; } = [];

    public Exception? BuildingModelFailure { get; set; }

    public Exception? GeometryUploadFailure { get; set; }

    public Exception? MetadataUploadFailure { get; set; }

    public byte[]? UploadedIfc { get; private set; }

    public byte[]? UploadedGeometry { get; private set; }

    public IReadOnlyList<BuildingModelElementMetadata>? UploadedMetadata { get; private set; }

    public string? UploadedFileName { get; private set; }

    public string? ActivatedVersion { get; private set; }

    public TaskCompletionSource<bool> ActivationStarted { get; } =
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    public TaskCompletionSource<bool>? ActivationGate { get; set; }

    public List<string> DeletedVersions { get; } = [];

    public List<string> BuildingModelOperations { get; } = [];

    public Task<IReadOnlyList<PropertySummary>> GetPropertiesAsync(
        string bearerToken,
        CancellationToken cancellationToken)
    {
        LastBearerToken = bearerToken;
        return BuildingModelFailure is null
            ? Task.FromResult<IReadOnlyList<PropertySummary>>([.. Properties])
            : Task.FromException<IReadOnlyList<PropertySummary>>(BuildingModelFailure);
    }

    public Task<BuildingModelSummary> GetBuildingModelAsync(
        string bearerToken,
        string propertyId,
        CancellationToken cancellationToken)
    {
        LastBearerToken = bearerToken;
        if (BuildingModelFailure is not null)
        {
            return Task.FromException<BuildingModelSummary>(BuildingModelFailure);
        }

        return BuildingModels.TryGetValue(propertyId, out var model)
            ? Task.FromResult(model)
            : Task.FromException<BuildingModelSummary>(
                new ApplianceApiException("MODEL_001", "BUILDING_MODEL_NOT_FOUND", 404));
    }

    public Task<byte[]> GetActiveModelGeometryAsync(
        string bearerToken,
        string propertyId,
        CancellationToken cancellationToken)
    {
        LastBearerToken = bearerToken;
        if (BuildingModelFailure is not null)
        {
            return Task.FromException<byte[]>(BuildingModelFailure);
        }

        return BuildingGeometry.TryGetValue(propertyId, out var geometry)
            ? Task.FromResult(geometry)
            : Task.FromException<byte[]>(
                new ApplianceApiException("MODEL_009", "MODEL_GEOMETRY_NOT_FOUND", 404));
    }

    public Task<BuildingModelMetadataSummary> GetActiveModelMetadataAsync(
        string bearerToken,
        string propertyId,
        CancellationToken cancellationToken)
    {
        LastBearerToken = bearerToken;
        if (BuildingModelFailure is not null)
        {
            return Task.FromException<BuildingModelMetadataSummary>(BuildingModelFailure);
        }

        return BuildingMetadata.TryGetValue(propertyId, out var metadata)
            ? Task.FromResult(metadata)
            : Task.FromException<BuildingModelMetadataSummary>(
                new ApplianceApiException("MODEL_012", "MODEL_METADATA_NOT_FOUND", 404));
    }

    public async Task<BuildingModelVersionSummary> UploadModelVersionAsync(
        string bearerToken,
        string propertyId,
        string fileName,
        Stream content,
        CancellationToken cancellationToken)
    {
        if (BuildingModelFailure is not null)
        {
            throw BuildingModelFailure;
        }

        UploadedIfc = await ReadAllAsync(content, cancellationToken);
        UploadedFileName = fileName;
        BuildingModelOperations.Add("ifc");
        var versionId = Guid.NewGuid().ToString();
        return new BuildingModelVersionSummary(
            versionId,
            $"model-{propertyId}",
            1,
            fileName,
            "hash",
            UploadedIfc.Length,
            null,
            "member-1",
            DateTime.UtcNow);
    }

    public Task UploadModelGeometryAsync(
        string bearerToken,
        string propertyId,
        string versionId,
        byte[] content,
        CancellationToken cancellationToken)
    {
        if (GeometryUploadFailure is not null)
        {
            throw GeometryUploadFailure;
        }

        cancellationToken.ThrowIfCancellationRequested();
        UploadedGeometry = [.. content];
        BuildingModelOperations.Add("geometry");
        return Task.CompletedTask;
    }

    public Task UploadModelMetadataAsync(
        string bearerToken,
        string propertyId,
        string versionId,
        IReadOnlyList<BuildingModelElementMetadata> elements,
        CancellationToken cancellationToken)
    {
        if (MetadataUploadFailure is not null)
        {
            throw MetadataUploadFailure;
        }

        cancellationToken.ThrowIfCancellationRequested();
        UploadedMetadata = [.. elements];
        BuildingModelOperations.Add("metadata");
        return Task.CompletedTask;
    }

    public async Task<BuildingModelSummary> ActivateModelVersionAsync(
        string bearerToken,
        string propertyId,
        string versionId,
        CancellationToken cancellationToken)
    {
        BuildingModelOperations.Add("activate");
        ActivationStarted.TrySetResult(true);
        if (ActivationGate is not null)
        {
            _ = await ActivationGate.Task.WaitAsync(cancellationToken);
        }

        ActivatedVersion = versionId;
        var model = new BuildingModelSummary(
            $"model-{propertyId}",
            propertyId,
            $"Model {propertyId}",
            versionId,
            1);
        BuildingModels[propertyId] = model;
        if (UploadedGeometry is not null)
        {
            BuildingGeometry[propertyId] = UploadedGeometry;
        }

        if (UploadedMetadata is not null)
        {
            BuildingMetadata[propertyId] =
                new BuildingModelMetadataSummary(versionId, 1, UploadedMetadata);
        }

        return model;
    }

    public Task DeleteModelVersionAsync(
        string bearerToken,
        string propertyId,
        string versionId,
        CancellationToken cancellationToken)
    {
        DeletedVersions.Add(versionId);
        BuildingModelOperations.Add("delete");
        return Task.CompletedTask;
    }

    // --- BIM operations ---------------------------------------------------

    public AccessSummary AccessToReturn { get; set; } =
        new("OWNER", [], true);

    public List<BimDevice> BimDevices { get; } = [];

    public List<BimDeviceStatus> BimDeviceStatuses { get; } = [];

    public Dictionary<string, IReadOnlyList<string>> MetricNames { get; } = [];

    public Dictionary<(string DeviceId, string Metric), IReadOnlyList<BimMetricPoint>> Metrics { get; } = [];

    public Dictionary<string, IReadOnlyList<BimStatusEvent>> StatusEvents { get; } = [];

    public List<BcfTopic> BcfTopics { get; } = [];

    public Exception? BimOperationsFailure { get; set; }

    public Task<AccessSummary> GetAccessSummaryAsync(
        string bearerToken,
        CancellationToken cancellationToken) =>
        BimOperationsFailure is null
            ? Task.FromResult(AccessToReturn)
            : Task.FromException<AccessSummary>(BimOperationsFailure);

    public Task<IReadOnlyList<BimDevice>> GetBuildingDevicesAsync(
        string bearerToken,
        string propertyId,
        CancellationToken cancellationToken) =>
        BimOperationsFailure is null
            ? Task.FromResult<IReadOnlyList<BimDevice>>(
                [.. BimDevices.Where(device =>
                    string.Equals(device.PropertyId, propertyId, StringComparison.Ordinal))])
            : Task.FromException<IReadOnlyList<BimDevice>>(BimOperationsFailure);

    public Task<BimDevice> SetDevicePositionAsync(
        string bearerToken,
        string deviceId,
        double? x,
        double? y,
        double? z,
        CancellationToken cancellationToken)
    {
        if (BimOperationsFailure is not null)
        {
            return Task.FromException<BimDevice>(BimOperationsFailure);
        }

        var index = BimDevices.FindIndex(device =>
            string.Equals(device.Id, deviceId, StringComparison.Ordinal));
        if (index < 0)
        {
            return Task.FromException<BimDevice>(
                new ApplianceApiException("INV_004", "DEVICE_NOT_FOUND", 404));
        }

        var updated = BimDevices[index] with
        {
            X = x,
            Y = y,
            Z = z,
            Version = BimDevices[index].Version + 1,
            UpdatedAt = DateTime.UtcNow,
        };
        BimDevices[index] = updated;
        return Task.FromResult(updated);
    }

    public Task<BimDevice> SetDeviceIfcLinkAsync(
        string bearerToken,
        string deviceId,
        string? ifcGlobalId,
        CancellationToken cancellationToken)
    {
        if (BimOperationsFailure is not null)
        {
            return Task.FromException<BimDevice>(BimOperationsFailure);
        }

        var index = BimDevices.FindIndex(device =>
            string.Equals(device.Id, deviceId, StringComparison.Ordinal));
        if (index < 0)
        {
            return Task.FromException<BimDevice>(
                new ApplianceApiException("INV_004", "DEVICE_NOT_FOUND", 404));
        }

        var updated = BimDevices[index] with
        {
            IfcGlobalId = ifcGlobalId,
            Version = BimDevices[index].Version + 1,
            UpdatedAt = DateTime.UtcNow,
        };
        BimDevices[index] = updated;
        return Task.FromResult(updated);
    }

    public Task<IReadOnlyList<BimDeviceStatus>> GetBuildingDeviceStatusAsync(
        string bearerToken,
        string propertyId,
        CancellationToken cancellationToken) =>
        BimOperationsFailure is null
            ? Task.FromResult<IReadOnlyList<BimDeviceStatus>>([.. BimDeviceStatuses])
            : Task.FromException<IReadOnlyList<BimDeviceStatus>>(BimOperationsFailure);

    public Task<IReadOnlyList<string>> GetDeviceMetricNamesAsync(
        string bearerToken,
        string deviceId,
        CancellationToken cancellationToken) =>
        BimOperationsFailure is null
            ? Task.FromResult(
                MetricNames.TryGetValue(deviceId, out var names)
                    ? names
                    : (IReadOnlyList<string>)[])
            : Task.FromException<IReadOnlyList<string>>(BimOperationsFailure);

    public Task<IReadOnlyList<BimMetricPoint>> GetDeviceMetricsAsync(
        string bearerToken,
        string deviceId,
        string metric,
        DateTime fromUtc,
        DateTime toUtc,
        CancellationToken cancellationToken) =>
        BimOperationsFailure is null
            ? Task.FromResult(
                Metrics.TryGetValue((deviceId, metric), out var points)
                    ? points
                    : (IReadOnlyList<BimMetricPoint>)[])
            : Task.FromException<IReadOnlyList<BimMetricPoint>>(BimOperationsFailure);

    public Task<IReadOnlyList<BimStatusEvent>> GetDeviceStatusEventsAsync(
        string bearerToken,
        string deviceId,
        CancellationToken cancellationToken) =>
        BimOperationsFailure is null
            ? Task.FromResult(
                StatusEvents.TryGetValue(deviceId, out var events)
                    ? events
                    : (IReadOnlyList<BimStatusEvent>)[])
            : Task.FromException<IReadOnlyList<BimStatusEvent>>(BimOperationsFailure);

    public Task<IReadOnlyList<BcfTopicSummary>> GetBcfTopicsAsync(
        string bearerToken,
        string propertyId,
        CancellationToken cancellationToken) =>
        BimOperationsFailure is null
            ? Task.FromResult<IReadOnlyList<BcfTopicSummary>>(
                [.. BcfTopics
                    .Where(topic =>
                        string.Equals(topic.PropertyId, propertyId, StringComparison.Ordinal))
                    .Select(static topic => new BcfTopicSummary(
                        topic.Id,
                        topic.PropertyId,
                        topic.Guid,
                        topic.Title,
                        topic.TopicType,
                        topic.TopicStatus,
                        topic.Priority,
                        topic.Version,
                        topic.CommentCount))])
            : Task.FromException<IReadOnlyList<BcfTopicSummary>>(BimOperationsFailure);

    public Task<BcfTopic> GetBcfTopicAsync(
        string bearerToken,
        string topicId,
        CancellationToken cancellationToken)
    {
        if (BimOperationsFailure is not null)
        {
            return Task.FromException<BcfTopic>(BimOperationsFailure);
        }

        var topic = BcfTopics.Find(candidate =>
            string.Equals(candidate.Id, topicId, StringComparison.Ordinal));
        return topic is not null
            ? Task.FromResult(topic)
            : Task.FromException<BcfTopic>(
                new ApplianceApiException("BCF_001", "BCF_TOPIC_NOT_FOUND", 404));
    }

    public Task<BcfTopic> CreateBcfTopicAsync(
        string bearerToken,
        string propertyId,
        CreateBcfTopic topic,
        CancellationToken cancellationToken)
    {
        if (BimOperationsFailure is not null)
        {
            return Task.FromException<BcfTopic>(BimOperationsFailure);
        }

        var id = Guid.NewGuid().ToString();
        var created = new BcfTopic(
            id,
            propertyId,
            Guid.NewGuid().ToString(),
            topic.Title,
            topic.TopicType,
            topic.TopicStatus,
            topic.Priority,
            1,
            0,
            [],
            [.. topic.Viewpoints.Select(viewpoint => new BcfViewpoint(
                Guid.NewGuid().ToString(),
                viewpoint.Guid ?? Guid.NewGuid().ToString(),
                viewpoint.Camera,
                viewpoint.Components,
                [],
                viewpoint.IsPrimary,
                viewpoint.SnapshotPngBase64 is not null))]);
        BcfTopics.Add(created);
        return Task.FromResult(created);
    }

    private static async Task<byte[]> ReadAllAsync(
        Stream content,
        CancellationToken cancellationToken)
    {
        using var destination = new MemoryStream();
        await content.CopyToAsync(destination, cancellationToken);
        return destination.ToArray();
    }
}

internal sealed class FakeApplianceClientFactory : IApplianceClientFactory
{
    public List<FakeApplianceClient> Created { get; } = [];

    public IApplianceClient Create(Uri baseUrl)
    {
        var client = new FakeApplianceClient(baseUrl);
        Created.Add(client);
        return client;
    }

    public FakeApplianceClient Last => Created[^1];
}

/// <summary>Records the authorize URL instead of opening a browser.</summary>
internal sealed class FakeBrowserLauncher : IBrowserLauncher
{
    public Uri? LastOpened { get; private set; }

    public void Open(Uri url) => LastOpened = url;
}

/// <summary>An in-memory vault.</summary>
internal sealed class InMemoryTokenVault : ITokenVault
{
    public VaultEntry? Entry { get; set; }

    public VaultEntry? Load() => Entry;

    public void Save(VaultEntry entry) => Entry = entry;

    public void Clear() => Entry = null;
}
