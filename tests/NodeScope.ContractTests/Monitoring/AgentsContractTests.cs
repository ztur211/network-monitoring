namespace NodeScope.ContractTests.Monitoring;

/// <summary>
/// Contract for <c>/api/v1/agents</c> - the operator-facing side of the agent
/// registry, session-authenticated and restricted to OWNER/ADMIN. This is where the
/// machine credentials are born and killed: an OWNER mints a single-use enrollment
/// code, sees enrolled collectors, and revokes or deletes them. Covers the manual
/// <c>{ success, data, timestamp }</c> envelopes, the fact that a revoke actually
/// invalidates the agent's <c>x-agent-token</c>, the org-scope isolation
/// (<c>AGENT_002</c>), and the auth/role gates (<c>AUTH_002</c>, <c>ORG_002</c>,
/// <c>ORG_003</c>). Each test provisions its own isolated org.
/// </summary>
[Collection(ContractSuite.Name)]
public class AgentsContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public AgentsContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task EnrollmentCode_as_owner_returns_a_single_use_code()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var response = await _api.PostAsync("v1/agents/enrollment-code", auth: org.OwnerAuth);

        Assert.Equal(HttpStatusCode.Created, response.Status);
        Assert.True(response.Json.GetProperty("success").GetBoolean());
        Assert.False(string.IsNullOrEmpty(response.Data.GetProperty("code").GetString()));
    }

    [Fact]
    public async Task Enrolled_agent_is_listed_with_status_APPROVED_and_its_metadata()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var agent = await MonitoringScaffold.EnrollAgentAsync(_api, org.OwnerAuth, name: "listed-agent");

        var list = await _api.GetAsync("v1/agents", org.OwnerAuth);

        Assert.Equal(HttpStatusCode.OK, list.Status);
        Assert.Equal(JsonValueKind.Array, list.Data.ValueKind);
        var listed = Assert.Single(
            list.Data.EnumerateArray(), a => a.GetProperty("id").GetString() == agent.AgentId);
        Assert.Equal("APPROVED", listed.GetProperty("status").GetString());
        Assert.Equal("listed-agent", listed.GetProperty("name").GetString());
        Assert.Equal("linux", listed.GetProperty("platform").GetString());
        Assert.Equal("1.0.0", listed.GetProperty("version").GetString());
    }

    [Fact]
    public async Task RevokeAgent_returns_the_id_and_its_token_is_then_rejected()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var agent = await MonitoringScaffold.EnrollAgentAsync(_api, org.OwnerAuth);

        // The token works before the revoke.
        var before = await _api.GetAsync("v1/monitoring/agent/devices", agent.AsAgentToken());
        Assert.Equal(HttpStatusCode.OK, before.Status);

        var revoke = await _api.PostAsync($"v1/agents/{agent.AgentId}/revoke", auth: org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, revoke.Status);
        Assert.Equal(agent.AgentId, revoke.Data.GetProperty("id").GetString());

        // ...and is rejected after it - the revoke really invalidated the credential.
        var after = await _api.GetAsync("v1/monitoring/agent/devices", agent.AsAgentToken());
        Assert.Equal(HttpStatusCode.Unauthorized, after.Status);
        Assert.Equal("AUTH_002", after.ErrorCode);
    }

    [Fact]
    public async Task DeleteAgent_returns_the_id_and_removes_it_from_the_list()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var agent = await MonitoringScaffold.EnrollAgentAsync(_api, org.OwnerAuth);

        var delete = await _api.DeleteAsync($"v1/agents/{agent.AgentId}", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, delete.Status);
        Assert.Equal(agent.AgentId, delete.Data.GetProperty("id").GetString());

        var list = await _api.GetAsync("v1/agents", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, list.Status);
        Assert.DoesNotContain(list.Data.EnumerateArray(), a => a.GetProperty("id").GetString() == agent.AgentId);
    }

    [Fact]
    public async Task AgentManagement_as_a_member_is_403_ORG_003()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var member = await OrgProvisioning.AddMemberAsync(_api, org);

        var list = await _api.GetAsync("v1/agents", member.AsBearer());
        Assert.Equal(HttpStatusCode.Forbidden, list.Status);
        Assert.Equal("ORG_003", list.ErrorCode);

        var mint = await _api.PostAsync("v1/agents/enrollment-code", auth: member.AsBearer());
        Assert.Equal(HttpStatusCode.Forbidden, mint.Status);
        Assert.Equal("ORG_003", mint.ErrorCode);
    }

    [Fact]
    public async Task AgentManagement_for_a_user_with_no_org_is_403_ORG_002()
    {
        var loner = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.GetAsync("v1/agents", loner.AsBearer());

        Assert.Equal(HttpStatusCode.Forbidden, response.Status);
        Assert.Equal("ORG_002", response.ErrorCode);
    }

    [Fact]
    public async Task AgentManagement_without_authentication_is_401_AUTH_002()
    {
        var response = await _api.GetAsync("v1/agents");

        Assert.Equal(HttpStatusCode.Unauthorized, response.Status);
        Assert.Equal("AUTH_002", response.ErrorCode);
    }

    [Fact]
    public async Task RevokeAgent_belonging_to_another_org_is_404_AGENT_002()
    {
        var owning = await _fixture.ProvisionOrgAsync();
        var agent = await MonitoringScaffold.EnrollAgentAsync(_api, owning.OwnerAuth);
        var other = await _fixture.ProvisionOrgAsync();

        var response = await _api.PostAsync($"v1/agents/{agent.AgentId}/revoke", auth: other.OwnerAuth);

        Assert.Equal(HttpStatusCode.NotFound, response.Status);
        Assert.Equal("AGENT_002", response.ErrorCode);
    }

    [Fact]
    public async Task DeleteAgent_belonging_to_another_org_is_404_AGENT_002()
    {
        var owning = await _fixture.ProvisionOrgAsync();
        var agent = await MonitoringScaffold.EnrollAgentAsync(_api, owning.OwnerAuth);
        var other = await _fixture.ProvisionOrgAsync();

        var response = await _api.DeleteAsync($"v1/agents/{agent.AgentId}", other.OwnerAuth);

        Assert.Equal(HttpStatusCode.NotFound, response.Status);
        Assert.Equal("AGENT_002", response.ErrorCode);
    }
}
