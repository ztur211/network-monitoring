using NodeScope.ContractTests.Inventory;

namespace NodeScope.ContractTests.Monitoring;

/// <summary>
/// Contract for POST v1/snmp/assign and its observable effect - the SNMP target the
/// agent device-sync resolves. Assign echoes the stored pair and treats explicit
/// nulls as unassign; both fields must be present. The credential/profile are
/// validated (org-scoped) before the target, so unknown and foreign ids alike are
/// SNMP_001/SNMP_002, and unknown targets are NETWORK_002/DEVICE_001. For an ADMIN
/// the F3 rules differ per target: a device needs its governing site in scope
/// (PERM_001), a network needs EVERY chartered site covered (PERM_004) - both proven
/// with the grant flip. (The network rule also unions in the device-footprint sites,
/// but a footprint outside the charters cannot be arranged black-box: placement
/// enforces the charter (PROP_007) and charter removal refuses to strand devices
/// (PROP_008), so the chartered-sites path is the reachable one.) Resolution is
/// override-wins per field - a device credential beats the network's while the
/// profile still falls back - proven through the agent devices list, the one place
/// plaintext secrets legitimately reappear.
/// </summary>
[Collection(ContractSuite.Name)]
public class SnmpAssignContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public SnmpAssignContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Assign_to_network_echoes_the_pair_and_explicit_nulls_unassign()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerCookie);
        var cred = await MonitoringScaffold.CreateCredentialAsync(_api, org.OwnerCookie);
        var profileId = await MonitoringScaffold.CreateOidProfileAsync(_api, org.OwnerCookie);

        var assign = await MonitoringScaffold.AssignAsync(
            _api, org.OwnerCookie, "network", site.NetworkId, cred.Id, profileId);
        Assert.Equal(HttpStatusCode.OK, assign.Status);
        Assert.Equal("network", assign.Data.GetProperty("targetType").GetString());
        Assert.Equal(site.NetworkId, assign.Data.GetProperty("targetId").GetString());
        Assert.Equal(cred.Id, assign.Data.GetProperty("snmpCredentialId").GetString());
        Assert.Equal(profileId, assign.Data.GetProperty("oidProfileId").GetString());

        var clear = await MonitoringScaffold.AssignAsync(
            _api, org.OwnerCookie, "network", site.NetworkId, null, null);
        Assert.Equal(HttpStatusCode.OK, clear.Status);
        Assert.Equal(JsonValueKind.Null, clear.Data.GetProperty("snmpCredentialId").ValueKind);
        Assert.Equal(JsonValueKind.Null, clear.Data.GetProperty("oidProfileId").ValueKind);
    }

    [Fact]
    public async Task Assign_to_device_echoes_the_pair()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerCookie);
        var device = await InventoryScaffold.CreateDeviceAsync(_api, org.OwnerCookie, site.NetworkId, site.SiteId);
        var deviceId = InventoryScaffold.RequireId(device);
        var cred = await MonitoringScaffold.CreateCredentialAsync(_api, org.OwnerCookie);

        var assign = await MonitoringScaffold.AssignAsync(
            _api, org.OwnerCookie, "device", deviceId, cred.Id, null);

        Assert.Equal(HttpStatusCode.OK, assign.Status);
        Assert.Equal("device", assign.Data.GetProperty("targetType").GetString());
        Assert.Equal(deviceId, assign.Data.GetProperty("targetId").GetString());
        Assert.Equal(cred.Id, assign.Data.GetProperty("snmpCredentialId").GetString());
        Assert.Equal(JsonValueKind.Null, assign.Data.GetProperty("oidProfileId").ValueKind);
    }

    [Fact]
    public async Task Assign_with_an_unknown_or_foreign_credential_is_404_SNMP_001()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerCookie);

        var unknown = await MonitoringScaffold.AssignAsync(
            _api, org.OwnerCookie, "network", site.NetworkId, Guid.NewGuid().ToString(), null);
        Assert.Equal(HttpStatusCode.NotFound, unknown.Status);
        Assert.Equal("SNMP_001", unknown.ErrorCode);

        // Another org's real credential must be indistinguishable from a missing one.
        var orgB = await _fixture.ProvisionOrgAsync();
        var credB = await MonitoringScaffold.CreateCredentialAsync(_api, orgB.OwnerCookie);
        var foreign = await MonitoringScaffold.AssignAsync(
            _api, org.OwnerCookie, "network", site.NetworkId, credB.Id, null);
        Assert.Equal(HttpStatusCode.NotFound, foreign.Status);
        Assert.Equal("SNMP_001", foreign.ErrorCode);
    }

    [Fact]
    public async Task Assign_with_an_unknown_profile_is_404_SNMP_002()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerCookie);

        var response = await MonitoringScaffold.AssignAsync(
            _api, org.OwnerCookie, "network", site.NetworkId, null, Guid.NewGuid().ToString());

        Assert.Equal(HttpStatusCode.NotFound, response.Status);
        Assert.Equal("SNMP_002", response.ErrorCode);
    }

    [Fact]
    public async Task Assign_to_an_unknown_or_foreign_target_is_404()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var unknownNetwork = await MonitoringScaffold.AssignAsync(
            _api, org.OwnerCookie, "network", Guid.NewGuid().ToString(), null, null);
        Assert.Equal(HttpStatusCode.NotFound, unknownNetwork.Status);
        Assert.Equal("NETWORK_002", unknownNetwork.ErrorCode);

        var unknownDevice = await MonitoringScaffold.AssignAsync(
            _api, org.OwnerCookie, "device", Guid.NewGuid().ToString(), null, null);
        Assert.Equal(HttpStatusCode.NotFound, unknownDevice.Status);
        Assert.Equal("DEVICE_001", unknownDevice.ErrorCode);

        // Another org's network and device are equally invisible.
        var orgB = await _fixture.ProvisionOrgAsync();
        var siteB = await InventoryScaffold.CharteredSiteAsync(_api, orgB.OwnerCookie);
        var deviceB = await InventoryScaffold.CreateDeviceAsync(_api, orgB.OwnerCookie, siteB.NetworkId, siteB.SiteId);

        var foreignNetwork = await MonitoringScaffold.AssignAsync(
            _api, org.OwnerCookie, "network", siteB.NetworkId, null, null);
        Assert.Equal(HttpStatusCode.NotFound, foreignNetwork.Status);
        Assert.Equal("NETWORK_002", foreignNetwork.ErrorCode);

        var foreignDevice = await MonitoringScaffold.AssignAsync(
            _api, org.OwnerCookie, "device", InventoryScaffold.RequireId(deviceB), null, null);
        Assert.Equal(HttpStatusCode.NotFound, foreignDevice.Status);
        Assert.Equal("DEVICE_001", foreignDevice.ErrorCode);
    }

    [Fact]
    public async Task Assign_body_must_carry_both_assignment_fields_and_a_valid_target_type()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerCookie);

        // Both assignment fields are required-present; null is the unassign value,
        // absence is a validation error.
        var missingBoth = await _api.PostAsync(
            "v1/snmp/assign",
            new { targetType = "network", targetId = site.NetworkId },
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.BadRequest, missingBoth.Status);
        Assert.Equal("GEN_001", missingBoth.ErrorCode);

        var missingCredential = await _api.PostAsync(
            "v1/snmp/assign",
            new { targetType = "network", targetId = site.NetworkId, oidProfileId = (string?)null },
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.BadRequest, missingCredential.Status);
        Assert.Equal("GEN_001", missingCredential.ErrorCode);

        var missingProfile = await _api.PostAsync(
            "v1/snmp/assign",
            new { targetType = "network", targetId = site.NetworkId, snmpCredentialId = (string?)null },
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.BadRequest, missingProfile.Status);
        Assert.Equal("GEN_001", missingProfile.ErrorCode);

        var badTargetType = await MonitoringScaffold.AssignAsync(
            _api, org.OwnerCookie, "circuit", site.NetworkId, null, null);
        Assert.Equal(HttpStatusCode.BadRequest, badTargetType.Status);
        Assert.Equal("GEN_001", badTargetType.ErrorCode);
    }

    [Fact]
    public async Task Admin_device_assignment_requires_the_governing_site_in_scope()
    {
        var (org, networkId, siteAId, siteBId, admin) = await TwoSiteOrgWithScopedAdminAsync();
        var deviceA = await InventoryScaffold.CreateDeviceAsync(_api, org.OwnerCookie, networkId, siteAId);
        var deviceB = await InventoryScaffold.CreateDeviceAsync(_api, org.OwnerCookie, networkId, siteBId);
        var cred = await MonitoringScaffold.CreateCredentialAsync(_api, org.OwnerCookie);

        var outOfScope = await MonitoringScaffold.AssignAsync(
            _api, admin.AsCookie(), "device", InventoryScaffold.RequireId(deviceB), cred.Id, null);
        Assert.Equal(HttpStatusCode.Forbidden, outOfScope.Status);
        Assert.Equal("PERM_001", outOfScope.ErrorCode);

        var inScope = await MonitoringScaffold.AssignAsync(
            _api, admin.AsCookie(), "device", InventoryScaffold.RequireId(deviceA), cred.Id, null);
        Assert.Equal(HttpStatusCode.OK, inScope.Status);
        Assert.Equal(cred.Id, inScope.Data.GetProperty("snmpCredentialId").GetString());
    }

    [Fact]
    public async Task Admin_network_assignment_requires_full_charter_coverage()
    {
        var (org, networkId, _, siteBId, admin) = await TwoSiteOrgWithScopedAdminAsync();
        var cred = await MonitoringScaffold.CreateCredentialAsync(_api, org.OwnerCookie);

        // Covering only one of the two chartered sites is not enough for a
        // network-level assignment.
        var partial = await MonitoringScaffold.AssignAsync(
            _api, admin.AsCookie(), "network", networkId, cred.Id, null);
        Assert.Equal(HttpStatusCode.Forbidden, partial.Status);
        Assert.Equal("PERM_004", partial.ErrorCode);

        // Granting the second site completes the coverage and flips the verdict.
        await GrantSiteToMemberAsync(org, admin, siteBId);
        var full = await MonitoringScaffold.AssignAsync(
            _api, admin.AsCookie(), "network", networkId, cred.Id, null);
        Assert.Equal(HttpStatusCode.OK, full.Status);
        Assert.Equal(cred.Id, full.Data.GetProperty("snmpCredentialId").GetString());
    }

    [Fact]
    public async Task Agent_device_sync_resolves_the_assigned_target_with_override_wins()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var monitored = await MonitoringScaffold.MonitoredDeviceAsync(_api, org.OwnerCookie);
        var agent = await MonitoringScaffold.EnrollAgentAsync(_api, org.OwnerCookie);

        // With nothing assigned anywhere, the device carries no snmp field at all.
        var bare = await AgentDeviceAsync(agent, monitored.DeviceId);
        Assert.False(bare.TryGetProperty("snmp", out _));

        // Network-level credential + profile: the target arrives with the community
        // DECRYPTED - the round-trip proof that create actually encrypted it - plus
        // the profile's OIDs and interface-metrics flag.
        var credA = await MonitoringScaffold.CreateCredentialAsync(_api, org.OwnerCookie);
        var profileId = await MonitoringScaffold.CreateOidProfileAsync(
            _api, org.OwnerCookie, includeInterfaceMetrics: true);
        var assignNetwork = await MonitoringScaffold.AssignAsync(
            _api, org.OwnerCookie, "network", monitored.NetworkId, credA.Id, profileId);
        Assert.Equal(HttpStatusCode.OK, assignNetwork.Status);

        var viaNetwork = (await AgentDeviceAsync(agent, monitored.DeviceId)).GetProperty("snmp");
        Assert.Equal("V2C", viaNetwork.GetProperty("version").GetString());
        Assert.Equal(credA.Community, viaNetwork.GetProperty("community").GetString());
        Assert.True(viaNetwork.GetProperty("interfaceMetrics").GetBoolean());
        var oid = Assert.Single(viaNetwork.GetProperty("oids").EnumerateArray());
        Assert.Equal("1.3.6.1.2.1.1.5.0", oid.GetProperty("oid").GetString());
        Assert.Equal("sysname", oid.GetProperty("metric").GetString());

        // A device-level credential wins over the network's, but the profile falls
        // back per field: the device's null profile does NOT blank the network's OIDs.
        var credB = await MonitoringScaffold.CreateCredentialAsync(_api, org.OwnerCookie);
        var assignDevice = await MonitoringScaffold.AssignAsync(
            _api, org.OwnerCookie, "device", monitored.DeviceId, credB.Id, null);
        Assert.Equal(HttpStatusCode.OK, assignDevice.Status);

        var overridden = (await AgentDeviceAsync(agent, monitored.DeviceId)).GetProperty("snmp");
        Assert.Equal(credB.Community, overridden.GetProperty("community").GetString());
        Assert.Single(overridden.GetProperty("oids").EnumerateArray());

        // Clearing the device-level pair restores the network default.
        var clearDevice = await MonitoringScaffold.AssignAsync(
            _api, org.OwnerCookie, "device", monitored.DeviceId, null, null);
        Assert.Equal(HttpStatusCode.OK, clearDevice.Status);

        var restored = (await AgentDeviceAsync(agent, monitored.DeviceId)).GetProperty("snmp");
        Assert.Equal(credA.Community, restored.GetProperty("community").GetString());
    }

    /// <summary>
    /// The F3 arrange: two chartered sites, an ADMIN member granted only the first.
    /// Everything over HTTP - the admin arrives via an OWNER invitation at role ADMIN,
    /// and the scope via a direct member-site grant.
    /// </summary>
    private async Task<(ProvisionedOrg Org, string NetworkId, string SiteAId, string SiteBId, UserSession Admin)> TwoSiteOrgWithScopedAdminAsync()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var siteAId = InventoryScaffold.RequireId(
            await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerCookie));
        var siteBId = InventoryScaffold.RequireId(
            await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerCookie));
        var networkId = InventoryScaffold.RequireId(
            await InventoryScaffold.CreateNetworkAsync(_api, org.OwnerCookie));
        await InventoryScaffold.CharterAsync(_api, org.OwnerCookie, networkId, siteAId);
        await InventoryScaffold.CharterAsync(_api, org.OwnerCookie, networkId, siteBId);

        var admin = await OrgProvisioning.AddMemberAsync(_api, org, role: "ADMIN");
        await GrantSiteToMemberAsync(org, admin, siteAId);

        return (org, networkId, siteAId, siteBId, admin);
    }

    private async Task GrantSiteToMemberAsync(ProvisionedOrg org, UserSession target, string propertyId)
    {
        var memberId = await OrgProvisioning.OrgMemberIdAsync(_api, org, target.UserId);
        var grant = await _api.PostAsync(
            $"v1/members/{memberId}/properties",
            new { propertyId },
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Created, grant.Status);
    }

    private async Task<JsonElement> AgentDeviceAsync(MonitoringScaffold.EnrolledAgent agent, string deviceId)
    {
        var list = await _api.GetAsync("v1/monitoring/agent/devices", agent.AsAgentToken());
        Assert.Equal(HttpStatusCode.OK, list.Status);
        return list.Data.EnumerateArray().Single(d => d.GetProperty("id").GetString() == deviceId);
    }
}
