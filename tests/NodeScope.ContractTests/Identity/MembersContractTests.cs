namespace NodeScope.ContractTests.Identity;

/// <summary>
/// Contract for member management (PATCH/DELETE v1/organizations/me/members/:userId).
/// The role matrix: an OWNER manages anyone; an ADMIN only ever touches MEMBERs and
/// may not raise anyone's role (any privileged target or destination is ORG_003);
/// a MEMBER is stopped at the guard. An unknown target is 404 ORG_002, and the last
/// OWNER can neither demote themselves nor be removed (409 ORG_013) - the invariant
/// that keeps an org governable. Removal is observable: the ex-member's org-scoped
/// calls flip to ORG_002.
/// </summary>
[Collection(ContractSuite.Name)]
public class MembersContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public MembersContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Owner_promotes_a_member_to_ADMIN_and_the_members_list_reflects_it()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var member = await OrgProvisioning.AddMemberAsync(_api, org);

        var patch = await _api.PatchAsync(
            $"v1/organizations/me/members/{member.UserId}",
            new { role = "ADMIN" },
            org.OwnerAuth);

        Assert.Equal(HttpStatusCode.OK, patch.Status);
        Assert.Equal(JsonValueKind.Null, patch.Data.ValueKind);

        var list = await _api.GetAsync("v1/organizations/me/members", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, list.Status);
        var row = list.Data.EnumerateArray().Single(m => m.GetProperty("userId").GetString() == member.UserId);
        Assert.Equal("ADMIN", row.GetProperty("role").GetString());
    }

    [Fact]
    public async Task Changing_an_unknown_member_is_404_ORG_002()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var response = await _api.PatchAsync(
            $"v1/organizations/me/members/{Guid.NewGuid()}",
            new { role = "ADMIN" },
            org.OwnerAuth);

        Assert.Equal(HttpStatusCode.NotFound, response.Status);
        Assert.Equal("ORG_002", response.ErrorCode);
    }

    [Fact]
    public async Task The_last_owner_can_neither_self_demote_nor_be_removed_409_ORG_013()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var demote = await _api.PatchAsync(
            $"v1/organizations/me/members/{org.Owner.UserId}",
            new { role = "MEMBER" },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Conflict, demote.Status);
        Assert.Equal("ORG_013", demote.ErrorCode);

        var remove = await _api.DeleteAsync(
            $"v1/organizations/me/members/{org.Owner.UserId}",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Conflict, remove.Status);
        Assert.Equal("ORG_013", remove.ErrorCode);
    }

    [Fact]
    public async Task Admin_may_remove_a_MEMBER_but_never_touch_privileged_roles()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var admin = await OrgProvisioning.AddMemberAsync(_api, org, role: "ADMIN");
        var otherAdmin = await OrgProvisioning.AddMemberAsync(_api, org, role: "ADMIN");
        var member = await OrgProvisioning.AddMemberAsync(_api, org);

        // Raising a MEMBER to ADMIN is a role change - OWNER-only.
        var promote = await _api.PatchAsync(
            $"v1/organizations/me/members/{member.UserId}",
            new { role = "ADMIN" },
            admin.AsBearer());
        Assert.Equal(HttpStatusCode.Forbidden, promote.Status);
        Assert.Equal("ORG_003", promote.ErrorCode);

        // Another ADMIN is a privileged target.
        var removeAdmin = await _api.DeleteAsync(
            $"v1/organizations/me/members/{otherAdmin.UserId}",
            admin.AsBearer());
        Assert.Equal(HttpStatusCode.Forbidden, removeAdmin.Status);
        Assert.Equal("ORG_003", removeAdmin.ErrorCode);

        // A plain MEMBER is manageable.
        var removeMember = await _api.DeleteAsync(
            $"v1/organizations/me/members/{member.UserId}",
            admin.AsBearer());
        Assert.Equal(HttpStatusCode.OK, removeMember.Status);
    }

    [Fact]
    public async Task Removal_evicts_the_member_from_the_org()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var member = await OrgProvisioning.AddMemberAsync(_api, org);

        var before = await _api.GetAsync("v1/organizations/me", member.AsBearer());
        Assert.Equal(HttpStatusCode.OK, before.Status);

        var remove = await _api.DeleteAsync(
            $"v1/organizations/me/members/{member.UserId}",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, remove.Status);
        Assert.Equal(JsonValueKind.Null, remove.Data.ValueKind);

        var after = await _api.GetAsync("v1/organizations/me", member.AsBearer());
        Assert.Equal(HttpStatusCode.Forbidden, after.Status);
        Assert.Equal("ORG_002", after.ErrorCode);
    }

    [Fact]
    public async Task A_member_cannot_manage_members_at_all()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var member = await OrgProvisioning.AddMemberAsync(_api, org);
        var other = await OrgProvisioning.AddMemberAsync(_api, org);

        var response = await _api.DeleteAsync(
            $"v1/organizations/me/members/{other.UserId}",
            member.AsBearer());

        Assert.Equal(HttpStatusCode.Forbidden, response.Status);
        Assert.Equal("ORG_003", response.ErrorCode);
    }
}
