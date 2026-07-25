using System.Text.Json;

namespace NodeScope.Desktop.Api;

/// <summary>HTTP surface of one appliance, as far as the client needs it so far.</summary>
internal interface IApplianceClient : IDisposable
{
    public Uri BaseUrl { get; }

    /// <summary>
    /// <c>POST /api/v1/desktop-auth/token</c>: burns the one-time code against its PKCE
    /// verifier and returns the session token to use as a Bearer credential.
    /// </summary>
    public Task<string> ExchangeDesktopCodeAsync(string code, string codeVerifier, CancellationToken cancellationToken);

    /// <summary><c>GET /api/v1/users/me</c> with the Bearer credential.</summary>
    public Task<CurrentUser> GetCurrentUserAsync(string bearerToken, CancellationToken cancellationToken);

    /// <summary><c>POST /api/v1/desktop-auth/revoke</c>: deletes the session behind the token.</summary>
    public Task RevokeAsync(string bearerToken, CancellationToken cancellationToken);

    /// <summary>
    /// True when the appliance serves the rasterized map style - false means the region
    /// extract has not been built yet (<c>nodescope.sh tiles</c>) and tiles would 404.
    /// </summary>
    public Task<bool> ProbeTilesAsync(CancellationToken cancellationToken);

    /// <summary><c>GET /api/v1/devices</c>: the full fleet (seeds the map's device cache).</summary>
    public Task<IReadOnlyList<MapDevice>> GetDevicesAsync(string bearerToken, CancellationToken cancellationToken);

    /// <summary><c>GET /api/v1/map/devices?bbox=…[&amp;floor=…]</c>: devices located inside the box.</summary>
    public Task<IReadOnlyList<MapDevice>> GetMapDevicesAsync(
        string bearerToken, MapBbox bbox, int? floor, CancellationToken cancellationToken);

    /// <summary><c>GET /api/v1/map/fiber-runs?bbox=…</c>: runs with either endpoint inside the box.</summary>
    public Task<IReadOnlyList<MapFiberRun>> GetMapFiberRunsAsync(
        string bearerToken, MapBbox bbox, CancellationToken cancellationToken);

    /// <summary>
    /// <c>GET /api/v1/users/me/preferences</c>: the free-form preferences JSON the clients
    /// share (the server stores it verbatim). Null when none were ever saved.
    /// </summary>
    public Task<JsonElement?> GetPreferencesAsync(string bearerToken, CancellationToken cancellationToken);

    /// <summary><c>PUT /api/v1/users/me/preferences</c>: replaces the shared preferences JSON.</summary>
    public Task PutPreferencesAsync(
        string bearerToken, JsonElement preferences, CancellationToken cancellationToken);

    /// <summary><c>GET /api/v1/properties</c>: the member's readable property tree.</summary>
    public Task<IReadOnlyList<PropertySummary>> GetPropertiesAsync(
        string bearerToken, CancellationToken cancellationToken);

    /// <summary><c>GET /api/v1/buildings/{id}/model</c>: active model metadata.</summary>
    public Task<BuildingModelSummary> GetBuildingModelAsync(
        string bearerToken, string propertyId, CancellationToken cancellationToken);

    /// <summary>
    /// <c>GET /api/v1/buildings/{id}/model/active/geometry</c>: the compact,
    /// cross-platform render artifact. The client enforces the appliance's 200 MiB
    /// ceiling even when an intermediary strips Content-Length.
    /// </summary>
    public Task<byte[]> GetActiveModelGeometryAsync(
        string bearerToken, string propertyId, CancellationToken cancellationToken);

    /// <summary>The active version's express-label to IFC GlobalId/type/name index.</summary>
    public Task<BuildingModelMetadataSummary> GetActiveModelMetadataAsync(
        string bearerToken, string propertyId, CancellationToken cancellationToken);

    /// <summary>
    /// Uploads the immutable IFC without activating it. The caller must pair the
    /// returned version with geometry before calling <see cref="ActivateModelVersionAsync"/>.
    /// </summary>
    public Task<BuildingModelVersionSummary> UploadModelVersionAsync(
        string bearerToken,
        string propertyId,
        string fileName,
        Stream content,
        CancellationToken cancellationToken);

    /// <summary>Uploads the wexBIM artifact derived from an immutable IFC version.</summary>
    public Task UploadModelGeometryAsync(
        string bearerToken,
        string propertyId,
        string versionId,
        byte[] content,
        CancellationToken cancellationToken);

    /// <summary>Uploads the product identity index extracted alongside wexBIM.</summary>
    public Task UploadModelMetadataAsync(
        string bearerToken,
        string propertyId,
        string versionId,
        IReadOnlyList<BuildingModelElementMetadata> elements,
        CancellationToken cancellationToken);

    /// <summary>Atomically makes the fully-paired version the model shown to readers.</summary>
    public Task<BuildingModelSummary> ActivateModelVersionAsync(
        string bearerToken,
        string propertyId,
        string versionId,
        CancellationToken cancellationToken);

    /// <summary>Compensates a failed import by removing its still-inactive version.</summary>
    public Task DeleteModelVersionAsync(
        string bearerToken,
        string propertyId,
        string versionId,
        CancellationToken cancellationToken);

    public Task<AccessSummary> GetAccessSummaryAsync(
        string bearerToken,
        CancellationToken cancellationToken);

    public Task<IReadOnlyList<BimDevice>> GetBuildingDevicesAsync(
        string bearerToken,
        string propertyId,
        CancellationToken cancellationToken);

    public Task<BimDevice> SetDevicePositionAsync(
        string bearerToken,
        string deviceId,
        double? x,
        double? y,
        double? z,
        CancellationToken cancellationToken);

    public Task<BimDevice> SetDeviceIfcLinkAsync(
        string bearerToken,
        string deviceId,
        string? ifcGlobalId,
        CancellationToken cancellationToken);

    public Task<IReadOnlyList<BimDeviceStatus>> GetBuildingDeviceStatusAsync(
        string bearerToken,
        string propertyId,
        CancellationToken cancellationToken);

    public Task<IReadOnlyList<string>> GetDeviceMetricNamesAsync(
        string bearerToken,
        string deviceId,
        CancellationToken cancellationToken);

    public Task<IReadOnlyList<BimMetricPoint>> GetDeviceMetricsAsync(
        string bearerToken,
        string deviceId,
        string metric,
        DateTime fromUtc,
        DateTime toUtc,
        CancellationToken cancellationToken);

    public Task<IReadOnlyList<BimStatusEvent>> GetDeviceStatusEventsAsync(
        string bearerToken,
        string deviceId,
        CancellationToken cancellationToken);

    // --- inventory CRUD ---------------------------------------------------

    /// <summary><c>GET /api/v1/devices</c>: the full fleet with every editable field.</summary>
    public Task<DevicePage> GetDeviceInventoryAsync(string bearerToken, CancellationToken cancellationToken);

    /// <summary><c>GET /api/v1/devices/{id}</c>: one device, fresh (the map edit flow's read).</summary>
    public Task<BimDevice> GetDeviceAsync(string bearerToken, string deviceId, CancellationToken cancellationToken);

    /// <summary><c>POST /api/v1/devices</c>. 422 <c>PROP_007</c> when the property is unchartered.</summary>
    public Task<BimDevice> CreateDeviceAsync(
        string bearerToken, CreateDevice device, CancellationToken cancellationToken);

    /// <summary>
    /// <c>PATCH /api/v1/devices/{id}</c> with the shared changeset body. A stale
    /// <paramref name="baseVersion"/> is 409 <c>SYNC_001</c>.
    /// </summary>
    public Task<BimDevice> UpdateDeviceAsync(
        string bearerToken,
        string deviceId,
        int baseVersion,
        IReadOnlyList<FieldChange> changes,
        CancellationToken cancellationToken);

    /// <summary><c>DELETE /api/v1/devices/{id}</c>.</summary>
    public Task DeleteDeviceAsync(string bearerToken, string deviceId, CancellationToken cancellationToken);

    /// <summary><c>GET /api/v1/devices/name-suggestion</c>: the next free "Router 2"-style name.</summary>
    public Task<string> GetDeviceNameSuggestionAsync(
        string bearerToken, string propertyId, string category, CancellationToken cancellationToken);

    /// <summary><c>GET /api/v1/circuits</c>: one page of the cursor-paginated list.</summary>
    public Task<CircuitPage> GetCircuitsAsync(
        string bearerToken, int limit, string? cursor, CancellationToken cancellationToken);

    /// <summary><c>POST /api/v1/circuits</c>.</summary>
    public Task<Circuit> CreateCircuitAsync(
        string bearerToken, CreateCircuit circuit, CancellationToken cancellationToken);

    /// <summary><c>PATCH /api/v1/circuits/{id}</c> with the shared changeset body.</summary>
    public Task<Circuit> UpdateCircuitAsync(
        string bearerToken,
        string circuitId,
        int baseVersion,
        IReadOnlyList<FieldChange> changes,
        CancellationToken cancellationToken);

    /// <summary><c>DELETE /api/v1/circuits/{id}</c>.</summary>
    public Task DeleteCircuitAsync(string bearerToken, string circuitId, CancellationToken cancellationToken);

    /// <summary><c>GET /api/v1/clients</c>: the calling client + agent availability.</summary>
    public Task<ClientsSummary> GetClientsAsync(string bearerToken, CancellationToken cancellationToken);

    /// <summary><c>GET /api/v1/networks</c>: the org's networks (in practice exactly one).</summary>
    public Task<IReadOnlyList<NetworkSummary>> GetNetworksAsync(
        string bearerToken, CancellationToken cancellationToken);

    public Task<IReadOnlyList<BcfTopicSummary>> GetBcfTopicsAsync(
        string bearerToken,
        string propertyId,
        CancellationToken cancellationToken);

    public Task<BcfTopic> GetBcfTopicAsync(
        string bearerToken,
        string topicId,
        CancellationToken cancellationToken);

    public Task<BcfTopic> CreateBcfTopicAsync(
        string bearerToken,
        string propertyId,
        CreateBcfTopic topic,
        CancellationToken cancellationToken);
}

/// <summary>
/// Creates a client for a given appliance URL. A factory because the URL is user
/// configuration, not deployment configuration - the sign-in screen can point the client
/// at a different appliance at any time.
/// </summary>
internal interface IApplianceClientFactory
{
    public IApplianceClient Create(Uri baseUrl);
}
