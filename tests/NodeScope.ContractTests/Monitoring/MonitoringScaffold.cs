using NodeScope.ContractTests.Inventory;

namespace NodeScope.ContractTests.Monitoring;

/// <summary>
/// Builds the state the machine-auth monitoring paths need over the same HTTP
/// surface a real operator and collector would use. Two credential families live
/// here (Decision 7): a per-agent token minted by enrolling against an owner-issued
/// code, and a per-org ingest token minted by the owner directly. Both are carried
/// in custom headers (<c>x-agent-token</c> / <c>x-ingest-token</c>) via
/// <see cref="Auth.WithHeader"/>. A probeable device also needs inventory scaffolding
/// - a chartered site and an IP'd device - so those steps reuse
/// <see cref="InventoryScaffold"/>.
/// </summary>
internal static class MonitoringScaffold
{
    /// <summary>An enrolled agent, holding the one-time plaintext token it authenticates with.</summary>
    /// <param name="AgentId">The agent's id, as returned by enroll.</param>
    /// <param name="Token">The persistent agent token (shown once; only its hash is stored).</param>
    internal sealed record EnrolledAgent(string AgentId, string Token)
    {
        /// <summary>The agent's <c>x-agent-token</c> credential.</summary>
        public Auth AsAgentToken() => Auth.WithHeader("x-agent-token", Token);
    }

    /// <summary>A chartered site carrying an IP'd device that an agent can probe and ingest for.</summary>
    /// <param name="NetworkId">The org's network, chartered over <paramref name="SiteId"/>.</param>
    /// <param name="SiteId">The top-level SITE the network is chartered over.</param>
    /// <param name="BuildingId">A BUILDING under the site; the device sits here so device-status can read it.</param>
    /// <param name="DeviceId">A device on the building with an IP address.</param>
    /// <param name="DeviceIp">The device's IP address.</param>
    internal sealed record MonitoredDevice(
        string NetworkId,
        string SiteId,
        string BuildingId,
        string DeviceId,
        string DeviceIp);

    /// <summary>The <c>x-ingest-token</c> header credential for a per-org ingest token.</summary>
    public static Auth IngestToken(string token) => Auth.WithHeader("x-ingest-token", token);

    /// <summary>The <c>id</c> of a captured <c>data</c> element, or a clear failure.</summary>
    public static string RequireId(JsonElement data) => InventoryScaffold.RequireId(data);

    /// <summary>Mints a single-use enrollment code as an OWNER/ADMIN and returns the plaintext.</summary>
    public static async Task<string> GenerateEnrollmentCodeAsync(
        ApiClient api,
        Auth ownerAuth,
        CancellationToken cancellationToken = default)
    {
        var response = await api.PostAsync("v1/agents/enrollment-code", auth: ownerAuth, cancellationToken: cancellationToken);
        Assert.Equal(HttpStatusCode.Created, response.Status);
        return response.Data.GetProperty("code").GetString()
            ?? throw new InvalidOperationException("enrollment-code response carried no code");
    }

    /// <summary>
    /// Enrolls a collector end to end: an owner mints a code, then the (session-less)
    /// enroll route redeems it for a persistent agent token.
    /// </summary>
    public static async Task<EnrolledAgent> EnrollAgentAsync(
        ApiClient api,
        Auth ownerAuth,
        string? name = null,
        CancellationToken cancellationToken = default)
    {
        var code = await GenerateEnrollmentCodeAsync(api, ownerAuth, cancellationToken);
        name ??= $"agent-{Guid.NewGuid():N}";

        var response = await api.PostAsync(
            "v1/monitoring/agent/enroll",
            new { code, name, platform = "linux", version = "1.0.0" },
            cancellationToken: cancellationToken);
        Assert.Equal(HttpStatusCode.Created, response.Status);

        var agentId = response.Data.GetProperty("agentId").GetString()
            ?? throw new InvalidOperationException("enroll response carried no agentId");
        var token = response.Data.GetProperty("token").GetString()
            ?? throw new InvalidOperationException("enroll response carried no token");
        return new EnrolledAgent(agentId, token);
    }

    /// <summary>Mints (or rotates) the per-org ingest token as an OWNER and returns the plaintext.</summary>
    public static async Task<string> MintIngestTokenAsync(
        ApiClient api,
        Auth ownerAuth,
        CancellationToken cancellationToken = default)
    {
        var response = await api.PostAsync("v1/monitoring/ingest-token", auth: ownerAuth, cancellationToken: cancellationToken);
        Assert.Equal(HttpStatusCode.Created, response.Status);
        return response.Data.GetProperty("token").GetString()
            ?? throw new InvalidOperationException("ingest-token response carried no token");
    }

    /// <summary>
    /// A created SNMP credential together with the plaintext community it was created
    /// with. Responses only ever carry presence flags, so a test that wants to prove
    /// the decrypt round-trip (through the agent devices list) must remember the
    /// plaintext itself.
    /// </summary>
    internal sealed record SnmpCredential(string Id, string Community);

    /// <summary>Creates a V2C credential with a unique community and returns both.</summary>
    public static async Task<SnmpCredential> CreateCredentialAsync(
        ApiClient api,
        Auth auth,
        string? name = null,
        CancellationToken cancellationToken = default)
    {
        var community = $"community-{Guid.NewGuid():N}";
        name ??= $"cred-{Guid.NewGuid():N}";
        var response = await api.PostAsync(
            "v1/snmp/credentials",
            new { name, snmpVersion = "V2C", community },
            auth,
            cancellationToken);
        Assert.Equal(HttpStatusCode.Created, response.Status);
        return new SnmpCredential(RequireId(response.Data), community);
    }

    /// <summary>Creates an OID profile (one sysName entry unless given) and returns its id.</summary>
    public static async Task<string> CreateOidProfileAsync(
        ApiClient api,
        Auth auth,
        string? name = null,
        bool includeInterfaceMetrics = false,
        object[]? entries = null,
        CancellationToken cancellationToken = default)
    {
        name ??= $"prof-{Guid.NewGuid():N}";
        entries ??= [new { oid = "1.3.6.1.2.1.1.5.0", metric = "sysname" }];
        var response = await api.PostAsync(
            "v1/snmp/oid-profiles",
            new { name, includeInterfaceMetrics, entries },
            auth,
            cancellationToken);
        Assert.Equal(HttpStatusCode.Created, response.Status);
        return RequireId(response.Data);
    }

    /// <summary>
    /// POSTs an assignment. Both assignment fields are always serialized - the contract
    /// requires them present, with an explicit null meaning unassign.
    /// </summary>
    public static Task<ApiResponse> AssignAsync(
        ApiClient api,
        Auth auth,
        string targetType,
        string targetId,
        string? snmpCredentialId,
        string? oidProfileId,
        CancellationToken cancellationToken = default) =>
        api.PostAsync(
            "v1/snmp/assign",
            new { targetType, targetId, snmpCredentialId, oidProfileId },
            auth,
            cancellationToken);

    /// <summary>
    /// Creates a device and returns its <c>data</c> element. An <paramref name="ip"/>
    /// makes it probeable (the agent devices list only returns IP'd devices); passing
    /// null creates one the agent would skip.
    /// </summary>
    public static async Task<JsonElement> CreateDeviceAsync(
        ApiClient api,
        Auth auth,
        string networkId,
        string propertyId,
        string? ip = null,
        string? name = null,
        CancellationToken cancellationToken = default)
    {
        name ??= $"mon-dev-{Guid.NewGuid():N}";
        object body = ip is null
            ? new { name, category = "SWITCH", networkId, propertyId }
            : new { name, category = "SWITCH", networkId, propertyId, ipAddress = ip };

        var response = await api.PostAsync("v1/devices", body, auth, cancellationToken);
        Assert.Equal(HttpStatusCode.Created, response.Status);
        return response.Data;
    }

    /// <summary>
    /// Assembles a SITE -> BUILDING under a chartered network with one IP'd device on
    /// the building - the minimum state for the agent devices list, ingest, and the
    /// device-status read to all have something real to work with.
    /// </summary>
    public static async Task<MonitoredDevice> MonitoredDeviceAsync(
        ApiClient api,
        Auth auth,
        string ip = "10.10.0.5",
        CancellationToken cancellationToken = default)
    {
        var site = await InventoryScaffold.CreatePropertyAsync(api, auth, "SITE", cancellationToken: cancellationToken);
        var siteId = InventoryScaffold.RequireId(site);
        var building = await InventoryScaffold.CreatePropertyAsync(api, auth, "BUILDING", parentId: siteId, cancellationToken: cancellationToken);
        var buildingId = InventoryScaffold.RequireId(building);

        var network = await InventoryScaffold.CreateNetworkAsync(api, auth, cancellationToken: cancellationToken);
        var networkId = InventoryScaffold.RequireId(network);
        await InventoryScaffold.CharterAsync(api, auth, networkId, siteId, cancellationToken);

        var device = await CreateDeviceAsync(api, auth, networkId, buildingId, ip: ip, cancellationToken: cancellationToken);
        var deviceId = InventoryScaffold.RequireId(device);

        return new MonitoredDevice(networkId, siteId, buildingId, deviceId, ip);
    }
}
