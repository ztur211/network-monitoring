namespace NodeScope.ContractTests.Inventory;

/// <summary>
/// Contract for GET v1/clients - the "your devices" read the dashboard shows. The
/// current device is described from the request itself (the User-Agent echoed
/// back, the platform parsed from it, the latest browser metric or null), and the
/// desktop agent is a fixed not-yet-available status. Org context is required.
/// </summary>
[Collection(ContractSuite.Name)]
public class ClientsContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public ClientsContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Clients_echoes_the_user_agent_and_parses_the_platform()
    {
        var org = await _fixture.ProvisionOrgAsync();
        const string userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ContractSuite/1.0";

        var response = await _api.GetAsync(
            "v1/clients",
            org.OwnerCookie.WithExtraHeader("User-Agent", userAgent));

        Assert.Equal(HttpStatusCode.OK, response.Status);
        var current = response.Data.GetProperty("currentDevice");
        Assert.Equal(userAgent, current.GetProperty("userAgent").GetString());
        Assert.Equal("Windows", current.GetProperty("platform").GetString());
        // A fresh user has never submitted a browser metric.
        Assert.Equal(JsonValueKind.Null, current.GetProperty("metrics").ValueKind);

        var agent = response.Data.GetProperty("agentStatus");
        Assert.False(agent.GetProperty("available").GetBoolean());
        Assert.False(string.IsNullOrEmpty(agent.GetProperty("message").GetString()));
    }

    [Fact]
    public async Task Clients_requires_org_context()
    {
        var orgless = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.GetAsync("v1/clients", orgless.AsCookie());

        Assert.Equal(HttpStatusCode.Forbidden, response.Status);
        Assert.Equal("ORG_002", response.ErrorCode);
    }
}
