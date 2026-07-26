using NodeScope.ContractTests.Inventory;

namespace NodeScope.ContractTests.Identity;

/// <summary>
/// Contract for the team surface beyond the lifecycle happy paths the Realtime
/// suite drives: the list read (scope-filtered - a site-less team is visible to
/// the unscoped OWNER but to no scoped member), the TEAM_002 name-uniqueness
/// conflict on create AND rename, the flat versioned rename body with its
/// SYNC_001 stale conflict, TEAM_001 for unknown teams, ORG_001 for unknown
/// members, idempotent member-add and site-assign (the same association id comes
/// back), and the MEMBER role gate.
/// </summary>
[Collection(ContractSuite.Name)]
public class TeamsContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public TeamsContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Create_returns_the_team_dto_and_duplicate_names_conflict_TEAM_002()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var create = await _api.PostAsync("v1/teams", new { name = "Field Ops" }, org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, create.Status);
        Assert.Equal("Field Ops", create.Data.GetProperty("name").GetString());
        Assert.Equal(org.OrganizationId, create.Data.GetProperty("organizationId").GetString());
        Assert.Equal(1, create.Data.GetProperty("version").GetInt32());
        Assert.False(string.IsNullOrEmpty(create.Data.GetProperty("creatorMemberId").GetString()));

        var duplicate = await _api.PostAsync("v1/teams", new { name = "Field Ops" }, org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Conflict, duplicate.Status);
        Assert.Equal("TEAM_002", duplicate.ErrorCode);
    }

    [Fact]
    public async Task List_is_scope_filtered_a_siteless_team_reaches_only_the_owner()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var member = await OrgProvisioning.AddMemberAsync(_api, org);

        var create = await _api.PostAsync("v1/teams", new { name = "Owner Only" }, org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, create.Status);
        var teamId = create.Data.GetProperty("id").GetString();

        var ownerList = await _api.GetAsync("v1/teams", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, ownerList.Status);
        Assert.Contains(ownerList.Data.EnumerateArray(), t => t.GetProperty("id").GetString() == teamId);

        // A scoped member sees no team whose sites don't intersect their scope -
        // and a site-less team intersects nothing.
        var memberList = await _api.GetAsync("v1/teams", member.AsBearer());
        Assert.Equal(HttpStatusCode.OK, memberList.Status);
        Assert.DoesNotContain(memberList.Data.EnumerateArray(), t => t.GetProperty("id").GetString() == teamId);
    }

    [Fact]
    public async Task Rename_is_versioned_stale_baseVersion_is_SYNC_001_and_name_clash_TEAM_002()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var teamId = await CreateTeamAsync(org, "Renamable");
        await CreateTeamAsync(org, "Taken");

        var renamed = await _api.PatchAsync(
            $"v1/teams/{teamId}",
            new { baseVersion = 1, name = "Renamed" },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, renamed.Status);
        Assert.Equal("Renamed", renamed.Data.GetProperty("name").GetString());
        Assert.Equal(2, renamed.Data.GetProperty("version").GetInt32());

        var stale = await _api.PatchAsync(
            $"v1/teams/{teamId}",
            new { baseVersion = 1, name = "Stale Write" },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Conflict, stale.Status);
        Assert.Equal("SYNC_001", stale.ErrorCode);

        var clash = await _api.PatchAsync(
            $"v1/teams/{teamId}",
            new { baseVersion = 2, name = "Taken" },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Conflict, clash.Status);
        Assert.Equal("TEAM_002", clash.ErrorCode);
    }

    [Fact]
    public async Task Unknown_team_is_404_TEAM_001()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var rename = await _api.PatchAsync(
            $"v1/teams/{Guid.NewGuid()}",
            new { baseVersion = 1, name = "Ghost" },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, rename.Status);
        Assert.Equal("TEAM_001", rename.ErrorCode);

        var delete = await _api.DeleteAsync($"v1/teams/{Guid.NewGuid()}", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, delete.Status);
        Assert.Equal("TEAM_001", delete.ErrorCode);
    }

    [Fact]
    public async Task Member_add_is_idempotent_and_an_unknown_member_is_404_ORG_001()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var teamId = await CreateTeamAsync(org, "Membership");
        var member = await OrgProvisioning.AddMemberAsync(_api, org);
        var memberId = await OrgProvisioning.OrgMemberIdAsync(_api, org, member.UserId);

        var first = await _api.PostAsync(
            $"v1/teams/{teamId}/members",
            new { memberId },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, first.Status);
        var associationId = first.Data.GetProperty("id").GetString();
        Assert.Equal(memberId, first.Data.GetProperty("memberId").GetString());

        // Adding the same member again returns the SAME association, not an error.
        var second = await _api.PostAsync(
            $"v1/teams/{teamId}/members",
            new { memberId },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, second.Status);
        Assert.Equal(associationId, second.Data.GetProperty("id").GetString());

        var unknown = await _api.PostAsync(
            $"v1/teams/{teamId}/members",
            new { memberId = Guid.NewGuid().ToString() },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, unknown.Status);
        Assert.Equal("ORG_001", unknown.ErrorCode);
    }

    [Fact]
    public async Task Site_assignment_is_idempotent_and_delete_returns_204()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var teamId = await CreateTeamAsync(org, "Sited");
        var site = await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerAuth);
        var siteId = InventoryScaffold.RequireId(site);

        var first = await _api.PostAsync(
            $"v1/teams/{teamId}/properties",
            new { propertyId = siteId },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, first.Status);
        var associationId = first.Data.GetProperty("id").GetString();

        var second = await _api.PostAsync(
            $"v1/teams/{teamId}/properties",
            new { propertyId = siteId },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, second.Status);
        Assert.Equal(associationId, second.Data.GetProperty("id").GetString());

        var unassign = await _api.DeleteAsync(
            $"v1/teams/{teamId}/properties/{siteId}",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NoContent, unassign.Status);

        var delete = await _api.DeleteAsync($"v1/teams/{teamId}", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NoContent, delete.Status);
        Assert.Equal(string.Empty, delete.Body);
    }

    [Fact]
    public async Task A_member_cannot_create_teams_ORG_003()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var member = await OrgProvisioning.AddMemberAsync(_api, org);

        var response = await _api.PostAsync("v1/teams", new { name = "Nope" }, member.AsBearer());

        Assert.Equal(HttpStatusCode.Forbidden, response.Status);
        Assert.Equal("ORG_003", response.ErrorCode);
    }

    private async Task<string> CreateTeamAsync(ProvisionedOrg org, string name)
    {
        var create = await _api.PostAsync("v1/teams", new { name }, org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, create.Status);
        return create.Data.GetProperty("id").GetString()
            ?? throw new InvalidOperationException("team create carried no id");
    }
}
