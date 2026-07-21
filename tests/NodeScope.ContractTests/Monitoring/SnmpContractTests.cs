using NodeScope.ContractTests.Inventory;

namespace NodeScope.ContractTests.Monitoring;

/// <summary>
/// Contract for the SNMP credential and OID-profile management surface (Spec 9).
/// Secrets go in but never come back: create accepts community/authKey/privKey and
/// responses carry only the has* presence flags - no body ever contains the
/// plaintext (or the *Enc column names). Unknown and foreign-org ids are the same
/// SNMP_001/SNMP_002 404. Deleting a credential/profile that is still assigned to a
/// network or device is refused with SNMP_003 until an explicit-null assign clears
/// it. The whole controller is role-gated OWNER/ADMIN - a MEMBER gets ORG_003 even
/// on reads.
/// </summary>
[Collection(ContractSuite.Name)]
public class SnmpContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public SnmpContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Credential_create_returns_presence_flags_and_never_echoes_the_secret()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var community = $"community-{Guid.NewGuid():N}";

        var response = await _api.PostAsync(
            "v1/snmp/credentials",
            new { name = "core-v2c", snmpVersion = "V2C", community },
            org.OwnerCookie);

        Assert.Equal(HttpStatusCode.Created, response.Status);
        Assert.True(response.Json.GetProperty("success").GetBoolean());
        var data = response.Data;
        Assert.Equal(org.OrganizationId, data.GetProperty("organizationId").GetString());
        Assert.Equal("core-v2c", data.GetProperty("name").GetString());
        Assert.Equal("V2C", data.GetProperty("snmpVersion").GetString());
        Assert.True(data.GetProperty("hasCommunity").GetBoolean());
        Assert.False(data.GetProperty("hasAuthKey").GetBoolean());
        Assert.False(data.GetProperty("hasPrivKey").GetBoolean());
        Assert.Equal(1, data.GetProperty("version").GetInt32());
        Assert.False(string.IsNullOrEmpty(data.GetProperty("createdAt").GetString()));

        // The secret must not appear anywhere in the response - not the plaintext,
        // and not the encrypted column either.
        Assert.DoesNotContain(community, response.Body, StringComparison.Ordinal);
        Assert.DoesNotContain("communityEnc", response.Body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Credential_V3_create_echoes_security_fields_and_flags_both_keys()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var authKey = $"auth-{Guid.NewGuid():N}";
        var privKey = $"priv-{Guid.NewGuid():N}";

        var response = await _api.PostAsync(
            "v1/snmp/credentials",
            new
            {
                name = "core-v3",
                snmpVersion = "V3",
                securityLevel = "AUTH_PRIV",
                securityName = "monitor",
                authProtocol = "SHA256",
                privProtocol = "AES256",
                authKey,
                privKey,
            },
            org.OwnerCookie);

        Assert.Equal(HttpStatusCode.Created, response.Status);
        var data = response.Data;
        Assert.Equal("V3", data.GetProperty("snmpVersion").GetString());
        Assert.Equal("AUTH_PRIV", data.GetProperty("securityLevel").GetString());
        Assert.Equal("monitor", data.GetProperty("securityName").GetString());
        Assert.Equal("SHA256", data.GetProperty("authProtocol").GetString());
        Assert.Equal("AES256", data.GetProperty("privProtocol").GetString());
        Assert.False(data.GetProperty("hasCommunity").GetBoolean());
        Assert.True(data.GetProperty("hasAuthKey").GetBoolean());
        Assert.True(data.GetProperty("hasPrivKey").GetBoolean());
        Assert.DoesNotContain(authKey, response.Body, StringComparison.Ordinal);
        Assert.DoesNotContain(privKey, response.Body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Credential_list_and_get_return_the_org_credentials_without_secrets()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var cred = await MonitoringScaffold.CreateCredentialAsync(_api, org.OwnerCookie);

        var list = await _api.GetAsync("v1/snmp/credentials", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, list.Status);
        var found = list.Data.EnumerateArray().Single(c => c.GetProperty("id").GetString() == cred.Id);
        Assert.True(found.GetProperty("hasCommunity").GetBoolean());
        Assert.DoesNotContain(cred.Community, list.Body, StringComparison.Ordinal);

        var get = await _api.GetAsync($"v1/snmp/credentials/{cred.Id}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, get.Status);
        Assert.Equal(cred.Id, get.Data.GetProperty("id").GetString());
        Assert.DoesNotContain(cred.Community, get.Body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Credential_get_unknown_or_foreign_is_404_SNMP_001()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var unknown = await _api.GetAsync($"v1/snmp/credentials/{Guid.NewGuid()}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.NotFound, unknown.Status);
        Assert.Equal("SNMP_001", unknown.ErrorCode);

        // A real credential in another org must be indistinguishable from a missing one.
        var orgB = await _fixture.ProvisionOrgAsync();
        var credB = await MonitoringScaffold.CreateCredentialAsync(_api, orgB.OwnerCookie);
        var foreign = await _api.GetAsync($"v1/snmp/credentials/{credB.Id}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.NotFound, foreign.Status);
        Assert.Equal("SNMP_001", foreign.ErrorCode);
    }

    [Fact]
    public async Task Credential_delete_is_refused_while_assigned_and_succeeds_after_unassign()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerCookie);
        var cred = await MonitoringScaffold.CreateCredentialAsync(_api, org.OwnerCookie);

        var assign = await MonitoringScaffold.AssignAsync(
            _api, org.OwnerCookie, "network", site.NetworkId, cred.Id, null);
        Assert.Equal(HttpStatusCode.OK, assign.Status);

        var refused = await _api.DeleteAsync($"v1/snmp/credentials/{cred.Id}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Conflict, refused.Status);
        Assert.Equal("SNMP_003", refused.ErrorCode);

        var clear = await MonitoringScaffold.AssignAsync(
            _api, org.OwnerCookie, "network", site.NetworkId, null, null);
        Assert.Equal(HttpStatusCode.OK, clear.Status);

        var deleted = await _api.DeleteAsync($"v1/snmp/credentials/{cred.Id}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, deleted.Status);
        Assert.Equal(cred.Id, deleted.Data.GetProperty("id").GetString());

        var gone = await _api.GetAsync($"v1/snmp/credentials/{cred.Id}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.NotFound, gone.Status);
        Assert.Equal("SNMP_001", gone.ErrorCode);
    }

    [Fact]
    public async Task Profile_create_returns_entries_and_list_returns_summaries_without_entries()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var create = await _api.PostAsync(
            "v1/snmp/oid-profiles",
            new
            {
                name = "std-profile",
                includeInterfaceMetrics = true,
                entries = new[]
                {
                    new { oid = "1.3.6.1.2.1.1.5.0", metric = "sysname" },
                    new { oid = "1.3.6.1.2.1.1.3.0", metric = "uptime" },
                },
            },
            org.OwnerCookie);

        Assert.Equal(HttpStatusCode.Created, create.Status);
        var data = create.Data;
        Assert.Equal("std-profile", data.GetProperty("name").GetString());
        Assert.True(data.GetProperty("includeInterfaceMetrics").GetBoolean());
        Assert.Equal(1, data.GetProperty("version").GetInt32());
        var entries = data.GetProperty("entries").EnumerateArray().ToList();
        Assert.Equal(2, entries.Count);
        foreach (var entry in entries)
        {
            Assert.False(string.IsNullOrEmpty(entry.GetProperty("id").GetString()));
            Assert.False(string.IsNullOrEmpty(entry.GetProperty("oid").GetString()));
            Assert.False(string.IsNullOrEmpty(entry.GetProperty("metric").GetString()));
        }

        var profileId = MonitoringScaffold.RequireId(data);

        // The list is a summary: same fields minus the entries.
        var list = await _api.GetAsync("v1/snmp/oid-profiles", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, list.Status);
        var summary = list.Data.EnumerateArray().Single(p => p.GetProperty("id").GetString() == profileId);
        Assert.True(summary.GetProperty("includeInterfaceMetrics").GetBoolean());
        Assert.False(summary.TryGetProperty("entries", out _));

        // The detail read carries them again.
        var get = await _api.GetAsync($"v1/snmp/oid-profiles/{profileId}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, get.Status);
        Assert.Equal(2, get.Data.GetProperty("entries").GetArrayLength());
    }

    [Fact]
    public async Task Profile_get_unknown_or_foreign_is_404_SNMP_002()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var unknown = await _api.GetAsync($"v1/snmp/oid-profiles/{Guid.NewGuid()}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.NotFound, unknown.Status);
        Assert.Equal("SNMP_002", unknown.ErrorCode);

        var orgB = await _fixture.ProvisionOrgAsync();
        var profileB = await MonitoringScaffold.CreateOidProfileAsync(_api, orgB.OwnerCookie);
        var foreign = await _api.GetAsync($"v1/snmp/oid-profiles/{profileB}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.NotFound, foreign.Status);
        Assert.Equal("SNMP_002", foreign.ErrorCode);
    }

    [Fact]
    public async Task Profile_delete_is_refused_while_assigned_and_succeeds_after_unassign()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerCookie);
        var profileId = await MonitoringScaffold.CreateOidProfileAsync(_api, org.OwnerCookie);

        var assign = await MonitoringScaffold.AssignAsync(
            _api, org.OwnerCookie, "network", site.NetworkId, null, profileId);
        Assert.Equal(HttpStatusCode.OK, assign.Status);

        var refused = await _api.DeleteAsync($"v1/snmp/oid-profiles/{profileId}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Conflict, refused.Status);
        Assert.Equal("SNMP_003", refused.ErrorCode);

        var clear = await MonitoringScaffold.AssignAsync(
            _api, org.OwnerCookie, "network", site.NetworkId, null, null);
        Assert.Equal(HttpStatusCode.OK, clear.Status);

        var deleted = await _api.DeleteAsync($"v1/snmp/oid-profiles/{profileId}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, deleted.Status);
        Assert.Equal(profileId, deleted.Data.GetProperty("id").GetString());
    }

    [Fact]
    public async Task Snmp_surface_admits_ADMIN_and_rejects_MEMBER_and_unauthenticated()
    {
        var org = await _fixture.ProvisionOrgAsync();

        // The role gate admits ADMIN - even reads are OWNER/ADMIN-only.
        var admin = await OrgProvisioning.AddMemberAsync(_api, org, role: "ADMIN");
        var adminList = await _api.GetAsync("v1/snmp/credentials", admin.AsCookie());
        Assert.Equal(HttpStatusCode.OK, adminList.Status);

        var member = await OrgProvisioning.AddMemberAsync(_api, org);
        var memberList = await _api.GetAsync("v1/snmp/credentials", member.AsCookie());
        Assert.Equal(HttpStatusCode.Forbidden, memberList.Status);
        Assert.Equal("ORG_003", memberList.ErrorCode);

        var memberAssign = await MonitoringScaffold.AssignAsync(
            _api, member.AsCookie(), "network", Guid.NewGuid().ToString(), null, null);
        Assert.Equal(HttpStatusCode.Forbidden, memberAssign.Status);
        Assert.Equal("ORG_003", memberAssign.ErrorCode);

        var unauth = await _api.GetAsync("v1/snmp/credentials");
        Assert.Equal(HttpStatusCode.Unauthorized, unauth.Status);
        Assert.Equal("AUTH_002", unauth.ErrorCode);
    }

    [Fact]
    public async Task Malformed_credential_or_profile_bodies_are_400_GEN_001()
    {
        var org = await _fixture.ProvisionOrgAsync();

        // V1 is not an SNMP version the contract admits.
        var badVersion = await _api.PostAsync(
            "v1/snmp/credentials",
            new { name = "bad", snmpVersion = "V1" },
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.BadRequest, badVersion.Status);
        Assert.Equal("GEN_001", badVersion.ErrorCode);

        // A profile entry without its metric fails nested validation.
        var badEntry = await _api.PostAsync(
            "v1/snmp/oid-profiles",
            new { name = "bad", entries = new[] { new { oid = "1.3.6.1.2.1.1.5.0" } } },
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.BadRequest, badEntry.Status);
        Assert.Equal("GEN_001", badEntry.ErrorCode);
    }
}
