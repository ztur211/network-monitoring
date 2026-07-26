namespace NodeScope.ContractTests.Monitoring;

/// <summary>
/// Contract for <c>/api/v1/monitoring/agent/*</c> - the collector-facing side,
/// authenticated by the machine <c>x-agent-token</c> rather than a session
/// (Decision 7). Covers the credential exchange (<c>enroll</c> redeems a single-use
/// code for a persistent token, and a bad or reused code is <c>AGENT_001</c>), the
/// token-gated probe list (<c>devices</c> returns only the org's IP'd devices), and
/// the heartbeat's 204. A missing or invalid token is <c>AUTH_002</c> on every gated
/// route. Each test provisions its own isolated org.
/// </summary>
[Collection(ContractSuite.Name)]
public class AgentIngestContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public AgentIngestContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Enroll_with_a_valid_code_returns_an_agent_id_and_token()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var code = await MonitoringScaffold.GenerateEnrollmentCodeAsync(_api, org.OwnerAuth);

        var response = await _api.PostAsync(
            "v1/monitoring/agent/enroll",
            new { code, name = "collector-01", platform = "linux", version = "2.1.0" });

        Assert.Equal(HttpStatusCode.Created, response.Status);
        Assert.False(string.IsNullOrEmpty(response.Data.GetProperty("agentId").GetString()));
        Assert.False(string.IsNullOrEmpty(response.Data.GetProperty("token").GetString()));
    }

    [Fact]
    public async Task Enroll_with_an_unknown_code_is_401_AGENT_001()
    {
        var response = await _api.PostAsync(
            "v1/monitoring/agent/enroll",
            new { code = $"not-a-real-code-{Guid.NewGuid():N}", name = "x", platform = "linux", version = "1.0.0" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.Status);
        Assert.Equal("AGENT_001", response.ErrorCode);
    }

    [Fact]
    public async Task Enroll_reusing_a_code_is_401_AGENT_001_the_second_time()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var code = await MonitoringScaffold.GenerateEnrollmentCodeAsync(_api, org.OwnerAuth);
        var payload = new { code, name = "single-use", platform = "linux", version = "1.0.0" };

        var first = await _api.PostAsync("v1/monitoring/agent/enroll", payload);
        Assert.Equal(HttpStatusCode.Created, first.Status);

        var second = await _api.PostAsync("v1/monitoring/agent/enroll", payload);
        Assert.Equal(HttpStatusCode.Unauthorized, second.Status);
        Assert.Equal("AGENT_001", second.ErrorCode);
    }

    [Fact]
    public async Task Devices_lists_only_the_orgs_ip_bearing_devices_for_a_valid_agent_token()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var monitored = await MonitoringScaffold.MonitoredDeviceAsync(_api, org.OwnerAuth);
        // A second device with no IP - nothing an agent can probe, so it must be omitted.
        var noIp = await MonitoringScaffold.CreateDeviceAsync(_api, org.OwnerAuth, monitored.NetworkId, monitored.BuildingId);
        var noIpId = MonitoringScaffold.RequireId(noIp);
        var agent = await MonitoringScaffold.EnrollAgentAsync(_api, org.OwnerAuth);

        var response = await _api.GetAsync("v1/monitoring/agent/devices", agent.AsAgentToken());

        Assert.Equal(HttpStatusCode.OK, response.Status);
        Assert.Equal(JsonValueKind.Array, response.Data.ValueKind);
        var probed = Assert.Single(
            response.Data.EnumerateArray(), d => d.GetProperty("id").GetString() == monitored.DeviceId);
        Assert.Equal(monitored.DeviceIp, probed.GetProperty("ipAddress").GetString());
        Assert.DoesNotContain(response.Data.EnumerateArray(), d => d.GetProperty("id").GetString() == noIpId);
    }

    [Fact]
    public async Task Devices_without_a_token_is_401_AUTH_002()
    {
        var response = await _api.GetAsync("v1/monitoring/agent/devices");

        Assert.Equal(HttpStatusCode.Unauthorized, response.Status);
        Assert.Equal("AUTH_002", response.ErrorCode);
    }

    [Fact]
    public async Task Devices_with_an_invalid_token_is_401_AUTH_002()
    {
        var response = await _api.GetAsync(
            "v1/monitoring/agent/devices",
            Auth.WithHeader("x-agent-token", $"bogus-{Guid.NewGuid():N}"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.Status);
        Assert.Equal("AUTH_002", response.ErrorCode);
    }

    [Fact]
    public async Task Heartbeat_with_a_valid_token_is_204_with_no_body()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var agent = await MonitoringScaffold.EnrollAgentAsync(_api, org.OwnerAuth);

        var response = await _api.PostAsync("v1/monitoring/agent/heartbeat", auth: agent.AsAgentToken());

        Assert.Equal(HttpStatusCode.NoContent, response.Status);
        Assert.True(string.IsNullOrEmpty(response.Body));
    }

    [Fact]
    public async Task Heartbeat_without_a_token_is_401_AUTH_002()
    {
        var response = await _api.PostAsync("v1/monitoring/agent/heartbeat");

        Assert.Equal(HttpStatusCode.Unauthorized, response.Status);
        Assert.Equal("AUTH_002", response.ErrorCode);
    }
}
