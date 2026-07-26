using NodeScope.ContractTests.Inventory;

namespace NodeScope.ContractTests.Identity;

/// <summary>
/// Contract for the member-assignment surface beyond the grant/revoke happy paths:
/// the access read (a target's roots AS SEEN BY the actor - an ADMIN sees only the
/// slice inside their own scope), ORG_001 for unknown members, and the two grant
/// guards - an ADMIN may not delegate a site beyond their own scope (PERM_002) nor
/// manage a privileged target (PERM_003).
/// </summary>
[Collection(ContractSuite.Name)]
public class MemberAccessContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public MemberAccessContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Owner_reads_a_members_full_roots_and_revoke_removes_them()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var siteId = InventoryScaffold.RequireId(
            await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerAuth));
        var member = await OrgProvisioning.AddMemberAsync(_api, org);
        var memberId = await OrgProvisioning.OrgMemberIdAsync(_api, org, member.UserId);

        var grant = await _api.PostAsync(
            $"v1/members/{memberId}/properties",
            new { propertyId = siteId },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, grant.Status);
        Assert.Equal(memberId, grant.Data.GetProperty("memberId").GetString());
        Assert.Equal(siteId, grant.Data.GetProperty("propertyId").GetString());

        var access = await _api.GetAsync($"v1/members/{memberId}/access", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, access.Status);
        Assert.Equal("MEMBER", access.Data.GetProperty("role").GetString());
        Assert.False(access.Data.GetProperty("unscoped").GetBoolean());
        Assert.Equal(
            [siteId],
            access.Data.GetProperty("assignedRootPropertyIds").EnumerateArray().Select(r => r.GetString()).ToList());

        var revoke = await _api.DeleteAsync(
            $"v1/members/{memberId}/properties/{siteId}",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NoContent, revoke.Status);

        var after = await _api.GetAsync($"v1/members/{memberId}/access", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, after.Status);
        Assert.Empty(after.Data.GetProperty("assignedRootPropertyIds").EnumerateArray());
    }

    [Fact]
    public async Task Unknown_member_is_404_ORG_001()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var access = await _api.GetAsync($"v1/members/{Guid.NewGuid()}/access", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, access.Status);
        Assert.Equal("ORG_001", access.ErrorCode);

        var grant = await _api.PostAsync(
            $"v1/members/{Guid.NewGuid()}/properties",
            new { propertyId = Guid.NewGuid().ToString() },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, grant.Status);
        Assert.Equal("ORG_001", grant.ErrorCode);
    }

    [Fact]
    public async Task Admin_cannot_delegate_beyond_their_own_scope_PERM_002()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var siteAId = InventoryScaffold.RequireId(
            await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerAuth));
        var siteBId = InventoryScaffold.RequireId(
            await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerAuth));

        var admin = await OrgProvisioning.AddMemberAsync(_api, org, role: "ADMIN");
        var adminMemberId = await OrgProvisioning.OrgMemberIdAsync(_api, org, admin.UserId);
        var grantAdmin = await _api.PostAsync(
            $"v1/members/{adminMemberId}/properties",
            new { propertyId = siteAId },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, grantAdmin.Status);

        var member = await OrgProvisioning.AddMemberAsync(_api, org);
        var memberId = await OrgProvisioning.OrgMemberIdAsync(_api, org, member.UserId);

        // Site B is outside the admin's own scope - delegating it is refused.
        var beyond = await _api.PostAsync(
            $"v1/members/{memberId}/properties",
            new { propertyId = siteBId },
            admin.AsBearer());
        Assert.Equal(HttpStatusCode.Forbidden, beyond.Status);
        Assert.Equal("PERM_002", beyond.ErrorCode);

        // Site A is within it - the grant lands.
        var within = await _api.PostAsync(
            $"v1/members/{memberId}/properties",
            new { propertyId = siteAId },
            admin.AsBearer());
        Assert.Equal(HttpStatusCode.Created, within.Status);
    }

    [Fact]
    public async Task Admin_cannot_manage_a_privileged_target_PERM_003()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var siteId = InventoryScaffold.RequireId(
            await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerAuth));

        var admin = await OrgProvisioning.AddMemberAsync(_api, org, role: "ADMIN");
        var adminMemberId = await OrgProvisioning.OrgMemberIdAsync(_api, org, admin.UserId);
        var grantAdmin = await _api.PostAsync(
            $"v1/members/{adminMemberId}/properties",
            new { propertyId = siteId },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, grantAdmin.Status);

        var otherAdmin = await OrgProvisioning.AddMemberAsync(_api, org, role: "ADMIN");
        var otherAdminMemberId = await OrgProvisioning.OrgMemberIdAsync(_api, org, otherAdmin.UserId);

        var response = await _api.PostAsync(
            $"v1/members/{otherAdminMemberId}/properties",
            new { propertyId = siteId },
            admin.AsBearer());

        Assert.Equal(HttpStatusCode.Forbidden, response.Status);
        Assert.Equal("PERM_003", response.ErrorCode);
    }
}
