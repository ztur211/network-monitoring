using System.Text.Json;

namespace NodeScope.Desktop.Api;

/// <summary>HTTP surface of one appliance, as far as the client needs it so far.</summary>
internal interface IApplianceClient : IDisposable
{
    public Uri BaseUrl { get; }

    /// <summary>
    /// <c>POST /api/v1/auth/sign-in</c>: trades the credentials for a session token to
    /// use as a Bearer credential.
    /// </summary>
    public Task<string> SignInAsync(string email, string password, CancellationToken cancellationToken);

    /// <summary>
    /// <c>POST /api/v1/auth/sign-up</c>: creates the account and returns its first
    /// session token - the appliance's only account-creation surface.
    /// </summary>
    public Task<string> SignUpAsync(
        string name, string email, string password, CancellationToken cancellationToken);

    /// <summary><c>GET /api/v1/users/me</c> with the Bearer credential.</summary>
    public Task<CurrentUser> GetCurrentUserAsync(string bearerToken, CancellationToken cancellationToken);

    /// <summary><c>POST /api/v1/auth/sign-out</c>: deletes the session behind the token.</summary>
    public Task SignOutAsync(string bearerToken, CancellationToken cancellationToken);

    // --- organization access ----------------------------------------------

    /// <summary>
    /// <c>GET /api/v1/organizations/me</c>. An authenticated account that has not
    /// joined an organization receives 403 <c>ORG_002</c>.
    /// </summary>
    public Task<OrganizationSummary> GetOrganizationAsync(
        string bearerToken,
        CancellationToken cancellationToken);

    /// <summary>
    /// <c>POST /api/v1/bootstrap/organization</c>: claims a fresh appliance with
    /// its installer-generated one-time credential.
    /// </summary>
    public Task<OrganizationSummary> BootstrapOrganizationAsync(
        string bearerToken,
        string organizationName,
        string bootstrapToken,
        CancellationToken cancellationToken);

    /// <summary><c>GET /api/v1/organizations/me/members</c>.</summary>
    public Task<IReadOnlyList<OrganizationMember>> GetOrganizationMembersAsync(
        string bearerToken,
        CancellationToken cancellationToken);

    /// <summary>
    /// <c>POST /api/v1/organizations/me/invitations</c>. The token is returned
    /// exactly once so an administrator can pass it to the invited person.
    /// </summary>
    public Task<CreatedInvitation> CreateInvitationAsync(
        string bearerToken,
        string email,
        string role,
        CancellationToken cancellationToken);

    /// <summary><c>GET /api/v1/organizations/me/invitations</c>.</summary>
    public Task<IReadOnlyList<PendingInvitation>> GetInvitationsAsync(
        string bearerToken,
        CancellationToken cancellationToken);

    /// <summary><c>DELETE /api/v1/organizations/me/invitations/{id}</c>.</summary>
    public Task RevokeInvitationAsync(
        string bearerToken,
        string invitationId,
        CancellationToken cancellationToken);

    /// <summary><c>POST /api/v1/invitations/accept</c>.</summary>
    public Task AcceptInvitationAsync(
        string bearerToken,
        string invitationToken,
        CancellationToken cancellationToken);

    /// <summary>
    /// <c>POST /api/v1/join-requests</c>: asks the organization claiming the
    /// caller's email domain for access.
    /// </summary>
    public Task SubmitJoinRequestAsync(
        string bearerToken,
        CancellationToken cancellationToken);

    /// <summary><c>GET /api/v1/organizations/me/join-requests</c>.</summary>
    public Task<IReadOnlyList<OrganizationJoinRequest>> GetJoinRequestsAsync(
        string bearerToken,
        CancellationToken cancellationToken);

    /// <summary>Approves or denies one pending organization join request.</summary>
    public Task DecideJoinRequestAsync(
        string bearerToken,
        string joinRequestId,
        bool approve,
        CancellationToken cancellationToken);

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

    /// <summary>
    /// <c>PUT /api/v1/buildings/{id}/model/georeference</c>: sets (or, with null, clears) the
    /// model's map anchor. The appliance re-derives every placed device's pin from it.
    /// </summary>
    public Task<BuildingModelSummary> SetModelGeoreferenceAsync(
        string bearerToken,
        string propertyId,
        ModelGeoreferenceSummary? georeference,
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

    /// <summary>
    /// <c>GET /api/bandwidth/echo</c>: drains the fixed random payload and returns the
    /// byte count. Raw wire (no envelope, no auth, uncacheable) - a bandwidth probe.
    /// </summary>
    public Task<long> DownloadBandwidthEchoAsync(CancellationToken cancellationToken);

    /// <summary><c>POST /api/bandwidth/echo</c>: uploads a probe payload; the server drains it.</summary>
    public Task UploadBandwidthEchoAsync(byte[] payload, CancellationToken cancellationToken);

    /// <summary><c>GET /api/v1/networks</c>: the org's networks (in practice exactly one).</summary>
    public Task<IReadOnlyList<NetworkSummary>> GetNetworksAsync(
        string bearerToken, CancellationToken cancellationToken);

    // --- settings ---------------------------------------------------------

    /// <summary>
    /// <c>PATCH /api/v1/users/me</c>. Only the provided fields ride (null = unchanged);
    /// a taken email is <c>AUTH_005</c>.
    /// </summary>
    public Task<CurrentUser> UpdateMeAsync(
        string bearerToken, string? name, string? email, CancellationToken cancellationToken);

    /// <summary>
    /// <c>POST /api/v1/users/location</c> with an address; the appliance geocodes it
    /// (Nominatim). An unresolvable address is <c>MAP_001</c>.
    /// </summary>
    public Task<HomeLocation> SetHomeLocationAsync(
        string bearerToken, string address, CancellationToken cancellationToken);

    /// <summary><c>GET /api/v1/users/me/data-sources</c>.</summary>
    public Task<IReadOnlyList<DataSource>> GetDataSourcesAsync(
        string bearerToken, CancellationToken cancellationToken);

    /// <summary><c>GET /api/v1/agents</c> (OWNER/ADMIN).</summary>
    public Task<IReadOnlyList<Agent>> GetAgentsAsync(string bearerToken, CancellationToken cancellationToken);

    /// <summary><c>POST /api/v1/agents/enrollment-code</c>: mints a one-time pairing code.</summary>
    public Task<string> CreateAgentEnrollmentCodeAsync(string bearerToken, CancellationToken cancellationToken);

    /// <summary><c>POST /api/v1/agents/{id}/revoke</c>.</summary>
    public Task RevokeAgentAsync(string bearerToken, string agentId, CancellationToken cancellationToken);

    /// <summary><c>GET /api/v1/snmp/credentials</c> (OWNER/ADMIN, like all of /snmp).</summary>
    public Task<IReadOnlyList<SnmpCredential>> GetSnmpCredentialsAsync(
        string bearerToken, CancellationToken cancellationToken);

    /// <summary><c>POST /api/v1/snmp/credentials</c>.</summary>
    public Task<SnmpCredential> CreateSnmpCredentialAsync(
        string bearerToken, CreateSnmpCredential credential, CancellationToken cancellationToken);

    /// <summary><c>DELETE /api/v1/snmp/credentials/{id}</c>. Assigned anywhere = 409 <c>SNMP_003</c>.</summary>
    public Task DeleteSnmpCredentialAsync(
        string bearerToken, string credentialId, CancellationToken cancellationToken);

    /// <summary><c>GET /api/v1/snmp/oid-profiles</c>.</summary>
    public Task<IReadOnlyList<OidProfileSummary>> GetOidProfilesAsync(
        string bearerToken, CancellationToken cancellationToken);

    /// <summary><c>POST /api/v1/snmp/oid-profiles</c>.</summary>
    public Task<OidProfileSummary> CreateOidProfileAsync(
        string bearerToken, CreateOidProfile profile, CancellationToken cancellationToken);

    /// <summary><c>DELETE /api/v1/snmp/oid-profiles/{id}</c>. Assigned anywhere = 409 <c>SNMP_003</c>.</summary>
    public Task DeleteOidProfileAsync(
        string bearerToken, string profileId, CancellationToken cancellationToken);

    /// <summary>
    /// <c>POST /api/v1/snmp/assign</c>. Both assignment ids are always serialized -
    /// null unassigns, absence would be a validation error.
    /// </summary>
    public Task<SnmpAssignment> AssignSnmpAsync(
        string bearerToken, SnmpAssignment assignment, CancellationToken cancellationToken);

    // --- alerts -----------------------------------------------------------

    public Task<IReadOnlyList<AlertChannel>> GetAlertChannelsAsync(
        string bearerToken,
        CancellationToken cancellationToken);

    public Task<AlertChannel> CreateAlertChannelAsync(
        string bearerToken,
        CreateAlertChannel channel,
        CancellationToken cancellationToken);

    public Task DeleteAlertChannelAsync(
        string bearerToken,
        string channelId,
        CancellationToken cancellationToken);

    public Task TestAlertChannelAsync(
        string bearerToken,
        string channelId,
        CancellationToken cancellationToken);

    public Task<IReadOnlyList<AlertRule>> GetAlertRulesAsync(
        string bearerToken,
        CancellationToken cancellationToken);

    public Task<AlertRule> CreateAlertRuleAsync(
        string bearerToken,
        CreateAlertRule rule,
        CancellationToken cancellationToken);

    public Task DeleteAlertRuleAsync(
        string bearerToken,
        string ruleId,
        CancellationToken cancellationToken);

    public Task<IReadOnlyList<AlertEvent>> GetAlertEventsAsync(
        string bearerToken,
        CancellationToken cancellationToken);

    // --- assistant ----------------------------------------------------------

    /// <summary><c>GET /api/v1/ai/usage</c>: the caller's quota counters and limits.</summary>
    public Task<AiUsage> GetAiUsageAsync(string bearerToken, CancellationToken cancellationToken);

    /// <summary>
    /// <c>DELETE /api/v1/ai/conversation/{id}</c>: forgets the server-side transcript.
    /// An unknown or already-gone conversation is 404 <c>GEN_002</c>.
    /// </summary>
    public Task DeleteAiConversationAsync(
        string bearerToken, string conversationId, CancellationToken cancellationToken);

    // --- onboarding -------------------------------------------------------

    /// <summary>
    /// <c>POST /api/v1/onboarding/turn</c> (OWNER/ADMIN). All-null input is the init
    /// turn; otherwise exactly one of <paramref name="chipChoice"/> or
    /// <paramref name="fieldValues"/> rides. Field values stay object-typed so a
    /// number field can be told from a string on the wire. Already-complete
    /// onboarding is 409 <c>ONBOARD_002</c>. The host rejects unknown body members,
    /// so nothing else (the web's <c>browserDeviceId</c> would 400 here).
    /// </summary>
    public Task<OnboardingTurn> SendOnboardingTurnAsync(
        string bearerToken,
        string? chipChoice,
        IReadOnlyDictionary<string, object>? fieldValues,
        CancellationToken cancellationToken);

    /// <summary><c>POST /api/v1/onboarding/skip</c>: dismisses the caller's wizard state.</summary>
    public Task SkipOnboardingAsync(string bearerToken, CancellationToken cancellationToken);

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
