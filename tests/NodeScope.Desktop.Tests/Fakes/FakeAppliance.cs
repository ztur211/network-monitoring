using System.Globalization;
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

    public Exception? SignInFailure { get; set; }

    public Exception? CurrentUserFailure { get; set; }

    /// <summary>When set, sign-in/sign-up park on this instead of completing immediately.</summary>
    public TaskCompletionSource<string>? SignInGate { get; set; }

    public int CredentialPosts { get; private set; }

    public (string Email, string Password)? LastSignIn { get; private set; }

    public (string Name, string Email, string Password)? LastSignUp { get; private set; }

    public string? LastBearerToken { get; private set; }

    public string? SignedOutToken { get; private set; }

    public Exception? AccessFailure { get; set; }

    public void Dispose()
    {
    }

    public Task<string> SignInAsync(string email, string password, CancellationToken cancellationToken)
    {
        CredentialPosts++;
        LastSignIn = (email, password);
        return CredentialResult();
    }

    public Task<string> SignUpAsync(
        string name, string email, string password, CancellationToken cancellationToken)
    {
        CredentialPosts++;
        LastSignUp = (name, email, password);
        return CredentialResult();
    }

    public Task<CurrentUser> GetCurrentUserAsync(string bearerToken, CancellationToken cancellationToken)
    {
        LastBearerToken = bearerToken;
        return CurrentUserFailure is null
            ? Task.FromResult(UserToReturn)
            : Task.FromException<CurrentUser>(CurrentUserFailure);
    }

    public Task SignOutAsync(string bearerToken, CancellationToken cancellationToken)
    {
        SignedOutToken = bearerToken;
        return Task.CompletedTask;
    }

    private Task<string> CredentialResult()
    {
        if (SignInGate is not null)
        {
            return SignInGate.Task;
        }

        return SignInFailure is null ? Task.FromResult(TokenToReturn) : Task.FromException<string>(SignInFailure);
    }

    // --- organization access ---------------------------------------------

    public OrganizationSummary OrganizationToReturn { get; set; } =
        new("org-1", "Acme Networks", 1);

    public List<OrganizationMember> OrganizationMembers { get; } =
    [
        new("member-1", "user-1", "org-1", "OWNER", DateTime.UtcNow, "owner@acme.test", "Owner"),
    ];

    public List<PendingInvitation> Invitations { get; } = [];

    public List<OrganizationJoinRequest> JoinRequests { get; } = [];

    public List<(string Email, string Role)> CreatedInvitations { get; } = [];

    public List<string> AcceptedInvitationTokens { get; } = [];

    public List<string> RevokedInvitationIds { get; } = [];

    public List<(string Id, bool Approve)> JoinRequestDecisions { get; } = [];

    public int JoinRequestSubmissions { get; private set; }

    public List<(string Name, string Token)> BootstrapRequests { get; } = [];

    public Task<OrganizationSummary> GetOrganizationAsync(
        string bearerToken,
        CancellationToken cancellationToken) =>
        AccessFailure is null
            ? Task.FromResult(OrganizationToReturn)
            : Task.FromException<OrganizationSummary>(AccessFailure);

    public Task<OrganizationSummary> BootstrapOrganizationAsync(
        string bearerToken,
        string organizationName,
        string bootstrapToken,
        CancellationToken cancellationToken)
    {
        if (AccessFailure is not null
            && AccessFailure is not ApplianceApiException { Code: "ORG_002" })
        {
            return Task.FromException<OrganizationSummary>(AccessFailure);
        }

        BootstrapRequests.Add((organizationName, bootstrapToken));
        OrganizationToReturn = OrganizationToReturn with { Name = organizationName };
        AccessFailure = null;
        return Task.FromResult(OrganizationToReturn);
    }

    public Task<IReadOnlyList<OrganizationMember>> GetOrganizationMembersAsync(
        string bearerToken,
        CancellationToken cancellationToken) =>
        AccessFailure is null
            ? Task.FromResult<IReadOnlyList<OrganizationMember>>([.. OrganizationMembers])
            : Task.FromException<IReadOnlyList<OrganizationMember>>(AccessFailure);

    public Task<CreatedInvitation> CreateInvitationAsync(
        string bearerToken,
        string email,
        string role,
        CancellationToken cancellationToken)
    {
        if (AccessFailure is not null)
        {
            return Task.FromException<CreatedInvitation>(AccessFailure);
        }

        CreatedInvitations.Add((email, role));
        var invitation = new PendingInvitation(
            $"invitation-{CreatedInvitations.Count}",
            email,
            role,
            DateTime.UtcNow.AddDays(7),
            null,
            DateTime.UtcNow);
        Invitations.Insert(0, invitation);
        return Task.FromResult(new CreatedInvitation(invitation, "invite-token-1"));
    }

    public Task<IReadOnlyList<PendingInvitation>> GetInvitationsAsync(
        string bearerToken,
        CancellationToken cancellationToken) =>
        AccessFailure is null
            ? Task.FromResult<IReadOnlyList<PendingInvitation>>([.. Invitations])
            : Task.FromException<IReadOnlyList<PendingInvitation>>(AccessFailure);

    public Task RevokeInvitationAsync(
        string bearerToken,
        string invitationId,
        CancellationToken cancellationToken)
    {
        if (AccessFailure is not null)
        {
            return Task.FromException(AccessFailure);
        }

        RevokedInvitationIds.Add(invitationId);
        Invitations.RemoveAll(invitation => invitation.Id == invitationId);
        return Task.CompletedTask;
    }

    public Task AcceptInvitationAsync(
        string bearerToken,
        string invitationToken,
        CancellationToken cancellationToken)
    {
        if (AccessFailure is not null)
        {
            return Task.FromException(AccessFailure);
        }

        AcceptedInvitationTokens.Add(invitationToken);
        return Task.CompletedTask;
    }

    public Task SubmitJoinRequestAsync(
        string bearerToken,
        CancellationToken cancellationToken)
    {
        if (AccessFailure is not null)
        {
            return Task.FromException(AccessFailure);
        }

        JoinRequestSubmissions++;
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<OrganizationJoinRequest>> GetJoinRequestsAsync(
        string bearerToken,
        CancellationToken cancellationToken) =>
        AccessFailure is null
            ? Task.FromResult<IReadOnlyList<OrganizationJoinRequest>>([.. JoinRequests])
            : Task.FromException<IReadOnlyList<OrganizationJoinRequest>>(AccessFailure);

    public Task DecideJoinRequestAsync(
        string bearerToken,
        string joinRequestId,
        bool approve,
        CancellationToken cancellationToken)
    {
        if (AccessFailure is not null)
        {
            return Task.FromException(AccessFailure);
        }

        var request = JoinRequests.SingleOrDefault(candidate => candidate.Id == joinRequestId);
        JoinRequestDecisions.Add((joinRequestId, approve));
        if (approve && request is not null)
        {
            OrganizationMembers.Add(new OrganizationMember(
                $"member-{OrganizationMembers.Count + 1}",
                request.UserId,
                request.OrganizationId,
                "MEMBER",
                DateTime.UtcNow,
                request.Email,
                request.Name));
        }

        JoinRequests.RemoveAll(request => request.Id == joinRequestId);
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

    public Exception? GeoreferenceFailure { get; set; }

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
            BuildingModels.TryGetValue(propertyId, out var existing) ? existing.Georeference : null,
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

    public Task<BuildingModelSummary> SetModelGeoreferenceAsync(
        string bearerToken,
        string propertyId,
        ModelGeoreferenceSummary? georeference,
        CancellationToken cancellationToken)
    {
        BuildingModelOperations.Add("georeference");
        if (GeoreferenceFailure is not null)
        {
            return Task.FromException<BuildingModelSummary>(GeoreferenceFailure);
        }

        if (!BuildingModels.TryGetValue(propertyId, out var model))
        {
            return Task.FromException<BuildingModelSummary>(
                new ApplianceApiException("MODEL_001", "BUILDING_MODEL_NOT_FOUND", 404));
        }

        var updated = model with { Georeference = georeference, Version = model.Version + 1 };
        BuildingModels[propertyId] = updated;
        return Task.FromResult(updated);
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
        AccessFailure is null && BimOperationsFailure is null
            ? Task.FromResult(AccessToReturn)
            : Task.FromException<AccessSummary>(AccessFailure ?? BimOperationsFailure!);

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

    // --- inventory CRUD ---------------------------------------------------

    public List<Circuit> Circuits { get; } = [];

    public List<NetworkSummary> Networks { get; } = [];

    public ClientsSummary ClientsToReturn { get; set; } = new(
        new ClientDevice("NodeScope-Desktop/1.0 (tests)", "Linux", null),
        new ClientAgentStatus(false, "Desktop Agent coming post-MVP."));

    public string SuggestedName { get; set; } = "Router 1";

    public long DownloadEchoBytes { get; set; } = 1_000_000;

    public Exception? BandwidthEchoFailure { get; set; }

    /// <summary>Runs inside each echo probe - lets a test advance a fake clock mid-transfer.</summary>
    public Func<CancellationToken, Task>? BandwidthEchoDelay { get; set; }

    public int DownloadEchoCalls { get; private set; }

    public List<int> UploadedEchoPayloads { get; } = [];

    public int CircuitPageSize { get; set; } = 50;

    public Exception? InventoryFailure { get; set; }

    public Exception? MutationFailure { get; set; }

    public List<CreateDevice> CreatedDevices { get; } = [];

    public List<(string DeviceId, int BaseVersion, IReadOnlyList<FieldChange> Changes)> DeviceUpdates { get; } = [];

    public List<string> DeletedDeviceIds { get; } = [];

    public List<CreateCircuit> CreatedCircuits { get; } = [];

    public List<(string CircuitId, int BaseVersion, IReadOnlyList<FieldChange> Changes)> CircuitUpdates { get; } = [];

    public List<string> DeletedCircuitIds { get; } = [];

    public List<string?> CircuitCursorRequests { get; } = [];

    public List<(string PropertyId, string Category)> SuggestionRequests { get; } = [];

    public Task<DevicePage> GetDeviceInventoryAsync(string bearerToken, CancellationToken cancellationToken)
    {
        LastBearerToken = bearerToken;
        return InventoryFailure is null
            ? Task.FromResult(new DevicePage([.. BimDevices], BimDevices.Count))
            : Task.FromException<DevicePage>(InventoryFailure);
    }

    public Task<BimDevice> GetDeviceAsync(string bearerToken, string deviceId, CancellationToken cancellationToken)
    {
        if (InventoryFailure is not null)
        {
            return Task.FromException<BimDevice>(InventoryFailure);
        }

        var device = BimDevices.Find(candidate => string.Equals(candidate.Id, deviceId, StringComparison.Ordinal));
        return device is not null
            ? Task.FromResult(device)
            : Task.FromException<BimDevice>(new ApplianceApiException("INV_004", "DEVICE_NOT_FOUND", 404));
    }

    public Task<BimDevice> CreateDeviceAsync(
        string bearerToken, CreateDevice device, CancellationToken cancellationToken)
    {
        if (MutationFailure is not null)
        {
            return Task.FromException<BimDevice>(MutationFailure);
        }

        CreatedDevices.Add(device);
        var created = new BimDevice(
            Guid.NewGuid().ToString(),
            device.NetworkId,
            device.PropertyId,
            null,
            "user-1",
            device.Name,
            device.Category,
            device.Latitude,
            device.Longitude,
            device.Floor,
            device.FloorLabel,
            null,
            null,
            null,
            null,
            device.IpAddress,
            device.MacAddress,
            device.Notes,
            1,
            DateTime.UtcNow,
            DateTime.UtcNow);
        BimDevices.Add(created);
        return Task.FromResult(created);
    }

    public Task<BimDevice> UpdateDeviceAsync(
        string bearerToken,
        string deviceId,
        int baseVersion,
        IReadOnlyList<FieldChange> changes,
        CancellationToken cancellationToken)
    {
        if (MutationFailure is not null)
        {
            return Task.FromException<BimDevice>(MutationFailure);
        }

        DeviceUpdates.Add((deviceId, baseVersion, changes));
        var index = BimDevices.FindIndex(candidate => string.Equals(candidate.Id, deviceId, StringComparison.Ordinal));
        if (index < 0)
        {
            return Task.FromException<BimDevice>(new ApplianceApiException("INV_004", "DEVICE_NOT_FOUND", 404));
        }

        if (BimDevices[index].Version != baseVersion)
        {
            return Task.FromException<BimDevice>(new ApplianceApiException("SYNC_001", "EDIT_CONFLICT", 409));
        }

        var updated = BimDevices[index];
        foreach (var change in changes)
        {
            updated = change.Field switch
            {
                "name" => updated with { Name = change.NewValue.GetString()! },
                "category" => updated with { Category = change.NewValue.GetString()! },
                "floor" => updated with
                {
                    Floor = change.NewValue.ValueKind == JsonValueKind.Number ? change.NewValue.GetInt32() : null,
                },
                "floorLabel" => updated with { FloorLabel = StringOrNull(change.NewValue) },
                "ipAddress" => updated with { IpAddress = StringOrNull(change.NewValue) },
                "macAddress" => updated with { MacAddress = StringOrNull(change.NewValue) },
                "notes" => updated with { Notes = StringOrNull(change.NewValue) },
                "latitude" => updated with
                {
                    Latitude = change.NewValue.ValueKind == JsonValueKind.Number ? change.NewValue.GetDouble() : null,
                },
                "longitude" => updated with
                {
                    Longitude = change.NewValue.ValueKind == JsonValueKind.Number ? change.NewValue.GetDouble() : null,
                },
                _ => updated,
            };
        }

        updated = updated with { Version = updated.Version + 1, UpdatedAt = DateTime.UtcNow };
        BimDevices[index] = updated;
        return Task.FromResult(updated);
    }

    public Task DeleteDeviceAsync(string bearerToken, string deviceId, CancellationToken cancellationToken)
    {
        if (MutationFailure is not null)
        {
            return Task.FromException(MutationFailure);
        }

        DeletedDeviceIds.Add(deviceId);
        _ = BimDevices.RemoveAll(candidate => string.Equals(candidate.Id, deviceId, StringComparison.Ordinal));
        return Task.CompletedTask;
    }

    public Task<string> GetDeviceNameSuggestionAsync(
        string bearerToken, string propertyId, string category, CancellationToken cancellationToken)
    {
        SuggestionRequests.Add((propertyId, category));
        return InventoryFailure is null
            ? Task.FromResult(SuggestedName)
            : Task.FromException<string>(InventoryFailure);
    }

    public Task<CircuitPage> GetCircuitsAsync(
        string bearerToken, int limit, string? cursor, CancellationToken cancellationToken)
    {
        CircuitCursorRequests.Add(cursor);
        if (InventoryFailure is not null)
        {
            return Task.FromException<CircuitPage>(InventoryFailure);
        }

        var start = cursor is null ? 0 : int.Parse(cursor, CultureInfo.InvariantCulture);
        var pageSize = Math.Min(limit, CircuitPageSize);
        var page = Circuits.Skip(start).Take(pageSize).ToList();
        var next = start + page.Count < Circuits.Count
            ? (start + page.Count).ToString(CultureInfo.InvariantCulture)
            : null;
        return Task.FromResult(new CircuitPage(page, next, Circuits.Count));
    }

    public Task<Circuit> CreateCircuitAsync(
        string bearerToken, CreateCircuit circuit, CancellationToken cancellationToken)
    {
        if (MutationFailure is not null)
        {
            return Task.FromException<Circuit>(MutationFailure);
        }

        CreatedCircuits.Add(circuit);
        var created = new Circuit(
            Guid.NewGuid().ToString(),
            "user-1",
            circuit.IspName,
            circuit.CircuitId,
            circuit.ServiceType,
            circuit.Bandwidth,
            circuit.DeviceId,
            circuit.Notes,
            1,
            DateTime.UtcNow,
            DateTime.UtcNow);
        Circuits.Insert(0, created);
        return Task.FromResult(created);
    }

    public Task<Circuit> UpdateCircuitAsync(
        string bearerToken,
        string circuitId,
        int baseVersion,
        IReadOnlyList<FieldChange> changes,
        CancellationToken cancellationToken)
    {
        if (MutationFailure is not null)
        {
            return Task.FromException<Circuit>(MutationFailure);
        }

        CircuitUpdates.Add((circuitId, baseVersion, changes));
        var index = Circuits.FindIndex(candidate => string.Equals(candidate.Id, circuitId, StringComparison.Ordinal));
        if (index < 0)
        {
            return Task.FromException<Circuit>(new ApplianceApiException("LINK_001", "CIRCUIT_NOT_FOUND", 404));
        }

        if (Circuits[index].Version != baseVersion)
        {
            return Task.FromException<Circuit>(new ApplianceApiException("SYNC_001", "EDIT_CONFLICT", 409));
        }

        var updated = Circuits[index];
        foreach (var change in changes)
        {
            updated = change.Field switch
            {
                "ispName" => updated with { IspName = change.NewValue.GetString()! },
                "serviceType" => updated with { ServiceType = change.NewValue.GetString()! },
                "circuitId" => updated with { CircuitId = StringOrNull(change.NewValue) },
                "bandwidth" => updated with
                {
                    Bandwidth = change.NewValue.ValueKind == JsonValueKind.Number ? change.NewValue.GetDouble() : null,
                },
                "deviceId" => updated with { DeviceId = StringOrNull(change.NewValue) },
                "notes" => updated with { Notes = StringOrNull(change.NewValue) },
                _ => updated,
            };
        }

        updated = updated with { Version = updated.Version + 1, UpdatedAt = DateTime.UtcNow };
        Circuits[index] = updated;
        return Task.FromResult(updated);
    }

    public Task DeleteCircuitAsync(string bearerToken, string circuitId, CancellationToken cancellationToken)
    {
        if (MutationFailure is not null)
        {
            return Task.FromException(MutationFailure);
        }

        DeletedCircuitIds.Add(circuitId);
        _ = Circuits.RemoveAll(candidate => string.Equals(candidate.Id, circuitId, StringComparison.Ordinal));
        return Task.CompletedTask;
    }

    public Task<ClientsSummary> GetClientsAsync(string bearerToken, CancellationToken cancellationToken) =>
        InventoryFailure is null
            ? Task.FromResult(ClientsToReturn)
            : Task.FromException<ClientsSummary>(InventoryFailure);

    public async Task<long> DownloadBandwidthEchoAsync(CancellationToken cancellationToken)
    {
        DownloadEchoCalls++;
        if (BandwidthEchoFailure is not null)
        {
            throw BandwidthEchoFailure;
        }

        if (BandwidthEchoDelay is { } delay)
        {
            await delay(cancellationToken);
        }

        return DownloadEchoBytes;
    }

    public async Task UploadBandwidthEchoAsync(byte[] payload, CancellationToken cancellationToken)
    {
        UploadedEchoPayloads.Add(payload.Length);
        if (BandwidthEchoFailure is not null)
        {
            throw BandwidthEchoFailure;
        }

        if (BandwidthEchoDelay is { } delay)
        {
            await delay(cancellationToken);
        }
    }

    public Task<IReadOnlyList<NetworkSummary>> GetNetworksAsync(
        string bearerToken, CancellationToken cancellationToken) =>
        InventoryFailure is null
            ? Task.FromResult<IReadOnlyList<NetworkSummary>>([.. Networks])
            : Task.FromException<IReadOnlyList<NetworkSummary>>(InventoryFailure);

    // --- settings ---------------------------------------------------------

    public List<Agent> Agents { get; } = [];

    public List<SnmpCredential> SnmpCredentials { get; } = [];

    public List<OidProfileSummary> OidProfiles { get; } = [];

    public List<DataSource> DataSourcesToReturn { get; } =
        [new DataSource("browser", false, null, "Browser monitoring inactive")];

    public string EnrollmentCodeToReturn { get; set; } = "code-abc123";

    public Exception? SettingsFailure { get; set; }

    public List<(string? Name, string? Email)> MeUpdates { get; } = [];

    public List<string> GeocodedAddresses { get; } = [];

    public List<string> RevokedAgentIds { get; } = [];

    public List<CreateSnmpCredential> CreatedSnmpCredentials { get; } = [];

    public List<string> DeletedSnmpCredentialIds { get; } = [];

    public List<CreateOidProfile> CreatedOidProfiles { get; } = [];

    public List<SnmpAssignment> Assignments { get; } = [];

    public Task<CurrentUser> UpdateMeAsync(
        string bearerToken, string? name, string? email, CancellationToken cancellationToken)
    {
        if (SettingsFailure is not null)
        {
            return Task.FromException<CurrentUser>(SettingsFailure);
        }

        MeUpdates.Add((name, email));
        UserToReturn = UserToReturn with
        {
            Name = name ?? UserToReturn.Name,
            Email = email ?? UserToReturn.Email,
        };
        return Task.FromResult(UserToReturn);
    }

    public Task<HomeLocation> SetHomeLocationAsync(
        string bearerToken, string address, CancellationToken cancellationToken)
    {
        if (SettingsFailure is not null)
        {
            return Task.FromException<HomeLocation>(SettingsFailure);
        }

        GeocodedAddresses.Add(address);
        return Task.FromResult(new HomeLocation(40.7128, -74.006, $"Resolved: {address}"));
    }

    public Task<IReadOnlyList<DataSource>> GetDataSourcesAsync(
        string bearerToken, CancellationToken cancellationToken) =>
        SettingsFailure is null
            ? Task.FromResult<IReadOnlyList<DataSource>>([.. DataSourcesToReturn])
            : Task.FromException<IReadOnlyList<DataSource>>(SettingsFailure);

    public Task<IReadOnlyList<Agent>> GetAgentsAsync(string bearerToken, CancellationToken cancellationToken) =>
        SettingsFailure is null
            ? Task.FromResult<IReadOnlyList<Agent>>([.. Agents])
            : Task.FromException<IReadOnlyList<Agent>>(SettingsFailure);

    public Task<string> CreateAgentEnrollmentCodeAsync(string bearerToken, CancellationToken cancellationToken) =>
        SettingsFailure is null
            ? Task.FromResult(EnrollmentCodeToReturn)
            : Task.FromException<string>(SettingsFailure);

    public Task RevokeAgentAsync(string bearerToken, string agentId, CancellationToken cancellationToken)
    {
        if (SettingsFailure is not null)
        {
            return Task.FromException(SettingsFailure);
        }

        RevokedAgentIds.Add(agentId);
        var index = Agents.FindIndex(agent => string.Equals(agent.Id, agentId, StringComparison.Ordinal));
        if (index >= 0)
        {
            Agents[index] = Agents[index] with { Status = "REVOKED" };
        }

        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<SnmpCredential>> GetSnmpCredentialsAsync(
        string bearerToken, CancellationToken cancellationToken) =>
        SettingsFailure is null
            ? Task.FromResult<IReadOnlyList<SnmpCredential>>([.. SnmpCredentials])
            : Task.FromException<IReadOnlyList<SnmpCredential>>(SettingsFailure);

    public Task<SnmpCredential> CreateSnmpCredentialAsync(
        string bearerToken, CreateSnmpCredential credential, CancellationToken cancellationToken)
    {
        if (SettingsFailure is not null)
        {
            return Task.FromException<SnmpCredential>(SettingsFailure);
        }

        CreatedSnmpCredentials.Add(credential);
        var created = new SnmpCredential(
            Guid.NewGuid().ToString(),
            credential.Name,
            credential.SnmpVersion,
            credential.SecurityLevel,
            credential.SecurityName,
            credential.AuthProtocol,
            credential.PrivProtocol,
            credential.Community is not null,
            credential.AuthKey is not null,
            credential.PrivKey is not null,
            1);
        SnmpCredentials.Add(created);
        return Task.FromResult(created);
    }

    public Task DeleteSnmpCredentialAsync(
        string bearerToken, string credentialId, CancellationToken cancellationToken)
    {
        if (SettingsFailure is not null)
        {
            return Task.FromException(SettingsFailure);
        }

        DeletedSnmpCredentialIds.Add(credentialId);
        _ = SnmpCredentials.RemoveAll(candidate =>
            string.Equals(candidate.Id, credentialId, StringComparison.Ordinal));
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<OidProfileSummary>> GetOidProfilesAsync(
        string bearerToken, CancellationToken cancellationToken) =>
        SettingsFailure is null
            ? Task.FromResult<IReadOnlyList<OidProfileSummary>>([.. OidProfiles])
            : Task.FromException<IReadOnlyList<OidProfileSummary>>(SettingsFailure);

    public Task<OidProfileSummary> CreateOidProfileAsync(
        string bearerToken, CreateOidProfile profile, CancellationToken cancellationToken)
    {
        if (SettingsFailure is not null)
        {
            return Task.FromException<OidProfileSummary>(SettingsFailure);
        }

        CreatedOidProfiles.Add(profile);
        var created = new OidProfileSummary(
            Guid.NewGuid().ToString(), profile.Name, profile.IncludeInterfaceMetrics, 1);
        OidProfiles.Add(created);
        return Task.FromResult(created);
    }

    public Task DeleteOidProfileAsync(
        string bearerToken, string profileId, CancellationToken cancellationToken)
    {
        if (SettingsFailure is not null)
        {
            return Task.FromException(SettingsFailure);
        }

        _ = OidProfiles.RemoveAll(candidate => string.Equals(candidate.Id, profileId, StringComparison.Ordinal));
        return Task.CompletedTask;
    }

    public Task<SnmpAssignment> AssignSnmpAsync(
        string bearerToken, SnmpAssignment assignment, CancellationToken cancellationToken)
    {
        if (SettingsFailure is not null)
        {
            return Task.FromException<SnmpAssignment>(SettingsFailure);
        }

        Assignments.Add(assignment);
        return Task.FromResult(assignment);
    }

    // --- alerts ------------------------------------------------------------

    public List<AlertChannel> AlertChannels { get; } = [];

    public List<AlertRule> AlertRules { get; } = [];

    public List<AlertEvent> AlertEvents { get; } = [];

    public List<CreateAlertChannel> CreatedAlertChannels { get; } = [];

    public List<CreateAlertRule> CreatedAlertRules { get; } = [];

    public List<string> TestedAlertChannelIds { get; } = [];

    public Exception? AlertFailure { get; set; }

    public Task<IReadOnlyList<AlertChannel>> GetAlertChannelsAsync(
        string bearerToken,
        CancellationToken cancellationToken) =>
        AlertFailure is null
            ? Task.FromResult<IReadOnlyList<AlertChannel>>([.. AlertChannels])
            : Task.FromException<IReadOnlyList<AlertChannel>>(AlertFailure);

    public Task<AlertChannel> CreateAlertChannelAsync(
        string bearerToken,
        CreateAlertChannel channel,
        CancellationToken cancellationToken)
    {
        if (AlertFailure is not null)
        {
            return Task.FromException<AlertChannel>(AlertFailure);
        }

        CreatedAlertChannels.Add(channel);
        var now = DateTime.UtcNow;
        var created = new AlertChannel(
            Guid.NewGuid().ToString(),
            "org-1",
            channel.Type,
            channel.Name,
            channel.Enabled,
            channel.Config,
            1,
            now,
            now);
        AlertChannels.Add(created);
        return Task.FromResult(created);
    }

    public Task DeleteAlertChannelAsync(
        string bearerToken,
        string channelId,
        CancellationToken cancellationToken)
    {
        if (AlertFailure is not null)
        {
            return Task.FromException(AlertFailure);
        }

        _ = AlertChannels.RemoveAll(channel =>
            string.Equals(channel.Id, channelId, StringComparison.Ordinal));
        return Task.CompletedTask;
    }

    public Task TestAlertChannelAsync(
        string bearerToken,
        string channelId,
        CancellationToken cancellationToken)
    {
        if (AlertFailure is not null)
        {
            return Task.FromException(AlertFailure);
        }

        TestedAlertChannelIds.Add(channelId);
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<AlertRule>> GetAlertRulesAsync(
        string bearerToken,
        CancellationToken cancellationToken) =>
        AlertFailure is null
            ? Task.FromResult<IReadOnlyList<AlertRule>>([.. AlertRules])
            : Task.FromException<IReadOnlyList<AlertRule>>(AlertFailure);

    public Task<AlertRule> CreateAlertRuleAsync(
        string bearerToken,
        CreateAlertRule rule,
        CancellationToken cancellationToken)
    {
        if (AlertFailure is not null)
        {
            return Task.FromException<AlertRule>(AlertFailure);
        }

        CreatedAlertRules.Add(rule);
        var now = DateTime.UtcNow;
        var created = new AlertRule(
            Guid.NewGuid().ToString(),
            "org-1",
            rule.Name,
            rule.Enabled,
            rule.Trigger,
            rule.Scope,
            rule.TargetStates,
            rule.Metric,
            rule.Op,
            rule.Threshold,
            rule.ForSeconds,
            rule.Severity,
            rule.ChannelIds,
            rule.CooldownSeconds,
            rule.NotifyOnRecovery,
            1,
            now,
            now);
        AlertRules.Add(created);
        return Task.FromResult(created);
    }

    public Task DeleteAlertRuleAsync(
        string bearerToken,
        string ruleId,
        CancellationToken cancellationToken)
    {
        if (AlertFailure is not null)
        {
            return Task.FromException(AlertFailure);
        }

        _ = AlertRules.RemoveAll(rule =>
            string.Equals(rule.Id, ruleId, StringComparison.Ordinal));
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<AlertEvent>> GetAlertEventsAsync(
        string bearerToken,
        CancellationToken cancellationToken) =>
        AlertFailure is null
            ? Task.FromResult<IReadOnlyList<AlertEvent>>([.. AlertEvents])
            : Task.FromException<IReadOnlyList<AlertEvent>>(AlertFailure);

    // --- assistant ----------------------------------------------------------

    public AiUsage UsageToReturn { get; set; } =
        new(0, 20, 0, 100, 0, 100_000, new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Utc));

    public Exception? AssistantFailure { get; set; }

    public List<string> DeletedConversations { get; } = [];

    public int UsageReads { get; private set; }

    public Task<AiUsage> GetAiUsageAsync(string bearerToken, CancellationToken cancellationToken)
    {
        LastBearerToken = bearerToken;
        UsageReads++;
        return AssistantFailure is null
            ? Task.FromResult(UsageToReturn)
            : Task.FromException<AiUsage>(AssistantFailure);
    }

    public Task DeleteAiConversationAsync(
        string bearerToken, string conversationId, CancellationToken cancellationToken)
    {
        if (AssistantFailure is not null)
        {
            return Task.FromException(AssistantFailure);
        }

        DeletedConversations.Add(conversationId);
        return Task.CompletedTask;
    }

    // --- onboarding -------------------------------------------------------

    /// <summary>Scripted turns, consumed in order; the last one repeats when exhausted.</summary>
    public List<OnboardingTurn> TurnsToReturn { get; } = [];

    public List<(string? ChipChoice, IReadOnlyDictionary<string, object>? FieldValues)> TurnRequests { get; } = [];

    public int SkipCalls { get; private set; }

    public Exception? OnboardingFailure { get; set; }

    public Task<OnboardingTurn> SendOnboardingTurnAsync(
        string bearerToken,
        string? chipChoice,
        IReadOnlyDictionary<string, object>? fieldValues,
        CancellationToken cancellationToken)
    {
        if (OnboardingFailure is not null)
        {
            return Task.FromException<OnboardingTurn>(OnboardingFailure);
        }

        TurnRequests.Add((chipChoice, fieldValues));
        if (TurnsToReturn.Count == 0)
        {
            return Task.FromResult(new OnboardingTurn(
                "welcome", "Welcome!", [new OnboardingChip("Let's go", "start")], [], false));
        }

        var turn = TurnsToReturn[0];
        if (TurnsToReturn.Count > 1)
        {
            TurnsToReturn.RemoveAt(0);
        }

        return Task.FromResult(turn);
    }

    public Task SkipOnboardingAsync(string bearerToken, CancellationToken cancellationToken)
    {
        if (OnboardingFailure is not null)
        {
            return Task.FromException(OnboardingFailure);
        }

        SkipCalls++;
        return Task.CompletedTask;
    }

    private static string? StringOrNull(JsonElement value) =>
        value.ValueKind == JsonValueKind.String ? value.GetString() : null;

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

    /// <summary>
    /// Applied to every client as it is created - the seam for scripting failures on a
    /// client the flow constructs and uses within one call (credential sign-in).
    /// </summary>
    public Action<FakeApplianceClient>? Configure { get; set; }

    public IApplianceClient Create(Uri baseUrl)
    {
        var client = new FakeApplianceClient(baseUrl);
        Configure?.Invoke(client);
        Created.Add(client);
        return client;
    }

    public FakeApplianceClient Last => Created[^1];
}

/// <summary>An in-memory vault.</summary>
internal sealed class InMemoryTokenVault : ITokenVault
{
    public VaultEntry? Entry { get; set; }

    public VaultEntry? Load() => Entry;

    public void Save(VaultEntry entry) => Entry = entry;

    public void Clear() => Entry = null;
}
