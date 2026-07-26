namespace NodeScope.ContractTests.Identity;

/// <summary>
/// The production installer credential only opens the first-organization transaction.
/// The contract target is already seeded, so it pins both gates around that happy path:
/// a bad credential fails before touching state, while the known development credential
/// still cannot create a second organization.
/// </summary>
[Collection(ContractSuite.Name)]
public sealed class BootstrapContractTests
{
    private readonly ApiClient _api;

    public BootstrapContractTests(ContractApiFixture fixture)
    {
        _api = fixture.Api;
    }

    [Fact]
    public async Task A_bad_bootstrap_token_is_403_ORG_017()
    {
        var user = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.PostAsync(
            "v1/bootstrap/organization",
            new { name = "Claimed by attacker", token = "wrong-token" },
            user.AsBearer());

        Assert.Equal(HttpStatusCode.Forbidden, response.Status);
        Assert.Equal("ORG_017", response.ErrorCode);
    }

    [Fact]
    public async Task The_bootstrap_token_cannot_create_a_second_organization()
    {
        _ = await AuthWorkflow.SignInAsSeedOwnerAsync(_api);
        var user = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.PostAsync(
            "v1/bootstrap/organization",
            new { name = "Second organization", token = "test-bootstrap-token" },
            user.AsBearer());

        Assert.Equal(HttpStatusCode.Conflict, response.Status);
        Assert.Equal("ORG_018", response.ErrorCode);
    }
}
