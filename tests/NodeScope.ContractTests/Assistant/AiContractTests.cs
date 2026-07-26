namespace NodeScope.ContractTests.Assistant;

/// <summary>
/// Contract for the AI HTTP surface - chat itself is WebSocket-only, so HTTP
/// exposes exactly two things: the usage read (the rate-limit counters with their
/// limits and reset instant) and the conversation delete. With the target's
/// provider deliberately degraded, usage never increments and no conversation is
/// ever persisted, so the delete's only reachable envelope is the GEN_002 404.
/// </summary>
[Collection(ContractSuite.Name)]
public class AiContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public AiContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Usage_reports_zeroed_counters_with_positive_limits_for_a_fresh_user()
    {
        var user = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.GetAsync("v1/ai/usage", user.AsBearer());

        Assert.Equal(HttpStatusCode.OK, response.Status);
        var data = response.Data;
        Assert.Equal(0, data.GetProperty("hourlyUsed").GetInt32());
        Assert.Equal(0, data.GetProperty("dailyUsed").GetInt32());
        Assert.Equal(0, data.GetProperty("monthlyTokensUsed").GetInt32());
        Assert.True(data.GetProperty("hourlyLimit").GetInt32() > 0);
        Assert.True(data.GetProperty("dailyLimit").GetInt32() > 0);
        Assert.True(data.GetProperty("monthlyTokenBudget").GetInt32() > 0);
        Assert.False(string.IsNullOrEmpty(data.GetProperty("resetsAt").GetString()));
    }

    [Fact]
    public async Task Deleting_an_unknown_conversation_is_404_GEN_002()
    {
        var user = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.DeleteAsync(
            $"v1/ai/conversation/{Guid.NewGuid()}",
            user.AsBearer());

        Assert.Equal(HttpStatusCode.NotFound, response.Status);
        Assert.Equal("GEN_002", response.ErrorCode);
    }

    [Fact]
    public async Task Usage_requires_a_session()
    {
        var response = await _api.GetAsync("v1/ai/usage");

        Assert.Equal(HttpStatusCode.Unauthorized, response.Status);
        Assert.Equal("AUTH_002", response.ErrorCode);
    }
}
