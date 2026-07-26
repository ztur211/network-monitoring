namespace NodeScope.ContractTests.Identity;

/// <summary>
/// Contract for the super-admin org-bootstrap surface at
/// <c>/api/v1/admin/organizations/*</c> - the only way an organization comes into
/// existence, since there is no self-service create-org endpoint. Also pins the
/// guard chain that protects it: unauthenticated callers get <c>AUTH_002</c>, and
/// authenticated non-super-admins get <c>ORG_007</c>. These tests double as the
/// end-to-end proof that the suite's super-admin bootstrap and per-test org
/// provisioning actually work against the target.
/// </summary>
[Collection(ContractSuite.Name)]
public class AdminOrganizationsContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public AdminOrganizationsContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task CreateOrganization_without_authentication_is_401_AUTH_002()
    {
        var response = await _api.PostAsync("v1/admin/organizations", new { name = "Unauthenticated" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.Status);
        Assert.Equal("AUTH_002", response.ErrorCode);
    }

    [Fact]
    public async Task CreateOrganization_as_a_non_super_admin_is_403_ORG_007()
    {
        var mortal = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.PostAsync("v1/admin/organizations", new { name = "Forbidden" }, mortal.AsBearer());

        Assert.Equal(HttpStatusCode.Forbidden, response.Status);
        Assert.Equal("ORG_007", response.ErrorCode);
    }

    [Fact]
    public async Task SuperAdmin_creates_an_org_and_designates_a_fresh_owner()
    {
        var superAdmin = await _fixture.SuperAdminAsync();

        var create = await _api.PostAsync(
            "v1/admin/organizations",
            new { name = $"Acme {Guid.NewGuid():N}" },
            superAdmin.AsBearer());

        Assert.Equal(HttpStatusCode.Created, create.Status);
        Assert.True(create.Json.GetProperty("success").GetBoolean());
        var orgId = create.Data.GetProperty("id").GetString();
        Assert.False(string.IsNullOrEmpty(orgId));

        var owner = await AuthWorkflow.SignUpAsync(_api);
        var designate = await _api.PostAsync(
            $"v1/admin/organizations/{orgId}/owner",
            new { email = owner.Email },
            superAdmin.AsBearer());

        Assert.Equal(HttpStatusCode.Created, designate.Status);
        Assert.Equal("OWNER", designate.Data.GetProperty("role").GetString());
        Assert.Equal(owner.UserId, designate.Data.GetProperty("userId").GetString());
        Assert.Equal(orgId, designate.Data.GetProperty("organizationId").GetString());

        // The designated owner now resolves that exact org as their own, with no re-auth.
        var me = await _api.GetAsync("v1/organizations/me", owner.AsBearer());
        Assert.Equal(HttpStatusCode.OK, me.Status);
        Assert.Equal(orgId, me.Data.GetProperty("id").GetString());
    }

    [Fact]
    public async Task DesignateOwner_for_a_user_already_in_an_org_is_409_ORG_003()
    {
        var existing = await _fixture.ProvisionOrgAsync();
        var superAdmin = await _fixture.SuperAdminAsync();

        var second = await _api.PostAsync(
            "v1/admin/organizations",
            new { name = $"Second {Guid.NewGuid():N}" },
            superAdmin.AsBearer());
        var secondId = second.Data.GetProperty("id").GetString();

        var response = await _api.PostAsync(
            $"v1/admin/organizations/{secondId}/owner",
            new { email = existing.Owner.Email },
            superAdmin.AsBearer());

        Assert.Equal(HttpStatusCode.Conflict, response.Status);
        Assert.Equal("ORG_003", response.ErrorCode);
    }

    [Fact]
    public async Task DesignateOwner_for_a_missing_organization_is_404_ORG_001()
    {
        var superAdmin = await _fixture.SuperAdminAsync();
        var owner = await AuthWorkflow.SignUpAsync(_api);
        var missingOrgId = Guid.NewGuid().ToString();

        var response = await _api.PostAsync(
            $"v1/admin/organizations/{missingOrgId}/owner",
            new { email = owner.Email },
            superAdmin.AsBearer());

        Assert.Equal(HttpStatusCode.NotFound, response.Status);
        Assert.Equal("ORG_001", response.ErrorCode);
    }

    [Fact]
    public async Task AddDomain_claims_a_domain_then_rejects_a_duplicate_409_ORG_004()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var superAdmin = await _fixture.SuperAdminAsync();
        var domain = $"contract-{Guid.NewGuid():N}.test";

        var first = await _api.PostAsync(
            $"v1/admin/organizations/{org.OrganizationId}/domains",
            new { domain },
            superAdmin.AsBearer());
        Assert.Equal(HttpStatusCode.Created, first.Status);

        var duplicate = await _api.PostAsync(
            $"v1/admin/organizations/{org.OrganizationId}/domains",
            new { domain },
            superAdmin.AsBearer());
        Assert.Equal(HttpStatusCode.Conflict, duplicate.Status);
        Assert.Equal("ORG_004", duplicate.ErrorCode);
    }
}
