namespace NodeScope.ContractTests.Identity;

/// <summary>
/// Contract for GET v1/access/me - the caller's own F3 access summary. An OWNER is
/// unscoped (empty root list, unscoped:true); everyone else reports exactly their
/// granted roots. This is the read every client uses to decide what to render, so
/// the shape is load-bearing.
/// </summary>
[Collection(ContractSuite.Name)]
public class AccessContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public AccessContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Owner_is_unscoped_with_an_empty_root_list()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var response = await _api.GetAsync("v1/access/me", org.OwnerCookie);

        Assert.Equal(HttpStatusCode.OK, response.Status);
        Assert.Equal("OWNER", response.Data.GetProperty("role").GetString());
        Assert.True(response.Data.GetProperty("unscoped").GetBoolean());
        Assert.Empty(response.Data.GetProperty("assignedRootPropertyIds").EnumerateArray());
    }

    [Fact]
    public async Task Member_reports_exactly_the_granted_roots()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await Inventory.InventoryScaffold.CreatePropertyAsync(_api, org.OwnerCookie);
        var siteId = Inventory.InventoryScaffold.RequireId(site);
        var member = await OrgProvisioning.AddMemberAsync(_api, org);

        // Before any grant: scoped, but to nothing.
        var before = await _api.GetAsync("v1/access/me", member.AsCookie());
        Assert.Equal(HttpStatusCode.OK, before.Status);
        Assert.Equal("MEMBER", before.Data.GetProperty("role").GetString());
        Assert.False(before.Data.GetProperty("unscoped").GetBoolean());
        Assert.Empty(before.Data.GetProperty("assignedRootPropertyIds").EnumerateArray());

        var memberId = await OrgProvisioning.OrgMemberIdAsync(_api, org, member.UserId);
        var grant = await _api.PostAsync(
            $"v1/members/{memberId}/properties",
            new { propertyId = siteId },
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Created, grant.Status);

        var after = await _api.GetAsync("v1/access/me", member.AsCookie());
        Assert.Equal(HttpStatusCode.OK, after.Status);
        var roots = after.Data.GetProperty("assignedRootPropertyIds").EnumerateArray()
            .Select(r => r.GetString()).ToList();
        Assert.Equal([siteId], roots);
    }

    [Fact]
    public async Task Access_requires_org_membership()
    {
        var orgless = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.GetAsync("v1/access/me", orgless.AsCookie());

        Assert.Equal(HttpStatusCode.Forbidden, response.Status);
        Assert.Equal("ORG_002", response.ErrorCode);
    }
}
