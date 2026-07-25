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
