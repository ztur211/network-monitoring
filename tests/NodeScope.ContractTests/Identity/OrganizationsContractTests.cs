namespace NodeScope.ContractTests.Identity;

/// <summary>
/// Contract for the org-context surface at <c>/api/v1/organizations/*</c>: how the
/// server resolves the caller's single organization and gates access to it. Read
/// paths run against the seeded owner and the populated seed org; the negative path
/// runs against a brand-new user who belongs to no org. Org-mutation paths run
/// against a freshly provisioned per-test org (a super-admin minting an isolated org
/// with a fresh OWNER) so a rename never disturbs the shared seed org.
/// </summary>
[Collection(ContractSuite.Name)]
public class OrganizationsContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public OrganizationsContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task GetMyOrg_as_the_seeded_owner_returns_that_organization()
    {
        var owner = await AuthWorkflow.SignInAsSeedOwnerAsync(_api);

        var response = await _api.GetAsync("v1/organizations/me", owner.AsCookie());

        Assert.Equal(HttpStatusCode.OK, response.Status);
        Assert.True(response.Json.GetProperty("success").GetBoolean());
        Assert.False(string.IsNullOrEmpty(response.Data.GetProperty("id").GetString()));
        Assert.False(string.IsNullOrEmpty(response.Data.GetProperty("name").GetString()));
    }

    [Fact]
    public async Task GetMyMembers_as_the_seeded_owner_includes_an_owner_membership()
    {
        var owner = await AuthWorkflow.SignInAsSeedOwnerAsync(_api);

        var response = await _api.GetAsync("v1/organizations/me/members", owner.AsCookie());

        Assert.Equal(HttpStatusCode.OK, response.Status);
        var members = response.Data;
        Assert.Equal(JsonValueKind.Array, members.ValueKind);

        var ownerMembership = members.EnumerateArray()
            .FirstOrDefault(m => m.GetProperty("userId").GetString() == owner.UserId);
        Assert.Equal(JsonValueKind.Object, ownerMembership.ValueKind);
        Assert.Equal("OWNER", ownerMembership.GetProperty("role").GetString());
    }

    [Fact]
    public async Task GetMyOrg_for_a_user_with_no_organization_is_403_ORG_002()
    {
        var loner = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.GetAsync("v1/organizations/me", loner.AsBearer());

        Assert.Equal(HttpStatusCode.Forbidden, response.Status);
        Assert.Equal("ORG_002", response.ErrorCode);
    }

    [Fact]
    public async Task PatchMyOrg_as_owner_renames_the_org_and_bumps_the_version()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var before = await _api.GetAsync("v1/organizations/me", org.OwnerCookie);
        var baseVersion = before.Data.GetProperty("version").GetInt32();
        var currentName = before.Data.GetProperty("name").GetString();
        var newName = $"Renamed {Guid.NewGuid():N}";

        var patch = await _api.PatchAsync(
            "v1/organizations/me",
            new
            {
                baseVersion,
                changes = new[] { new { field = "name", oldValue = currentName, newValue = newName } },
            },
            org.OwnerCookie);

        Assert.Equal(HttpStatusCode.OK, patch.Status);
        Assert.Equal(newName, patch.Data.GetProperty("name").GetString());
        Assert.Equal(baseVersion + 1, patch.Data.GetProperty("version").GetInt32());
    }

    [Fact]
    public async Task PatchMyOrg_with_a_stale_base_version_is_409_SYNC_001()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var before = await _api.GetAsync("v1/organizations/me", org.OwnerCookie);
        var baseVersion = before.Data.GetProperty("version").GetInt32();

        // First rename lands, advancing the version past baseVersion.
        var first = await _api.PatchAsync(
            "v1/organizations/me",
            new
            {
                baseVersion,
                changes = new[] { new { field = "name", oldValue = (string?)null, newValue = "First" } },
            },
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, first.Status);

        // Replaying the same baseVersion is now stale.
        var stale = await _api.PatchAsync(
            "v1/organizations/me",
            new
            {
                baseVersion,
                changes = new[] { new { field = "name", oldValue = (string?)null, newValue = "Second" } },
            },
            org.OwnerCookie);

        Assert.Equal(HttpStatusCode.Conflict, stale.Status);
        Assert.Equal("SYNC_001", stale.ErrorCode);
    }
}
