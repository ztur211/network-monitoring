namespace NodeScope.ContractTests.Inventory;

/// <summary>
/// Contract for the onboarding wizard (v1/onboarding/{turn,skip}). The turn
/// endpoint drives a server-side state machine: each response carries the next
/// stepId with its structural UI (chips/fields), the accumulated progress, and a
/// bot message. Walking the shortest path proves the transitions, the network
/// side effect (the address-step save creates the org's network), and the
/// completion gate - once finished, a fresh turn is ONBOARD_002 (409). Skip
/// clears the in-flight state so a later turn restarts from the top, and the
/// whole surface is OWNER/ADMIN-gated on turn.
/// </summary>
[Collection(ContractSuite.Name)]
public class OnboardingContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public OnboardingContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task The_wizard_walks_to_completion_and_then_refuses_ONBOARD_002()
    {
        var org = await _fixture.ProvisionOrgAsync();

        // welcome → networkName: the init turn renders a required name field.
        var start = await TurnAsync(org, new { });
        Assert.Equal("networkName", start.GetProperty("stepId").GetString());
        Assert.False(start.GetProperty("complete").GetBoolean());
        Assert.False(string.IsNullOrEmpty(start.GetProperty("botMessage").GetString()));
        var nameField = Assert.Single(start.GetProperty("fields").EnumerateArray());
        Assert.Equal("name", nameField.GetProperty("key").GetString());
        Assert.True(nameField.GetProperty("required").GetBoolean());

        // networkName → address: progress starts accumulating.
        var named = await TurnAsync(org, new { fieldValues = new { name = "Contract HQ" } });
        Assert.Equal("address", named.GetProperty("stepId").GetString());
        Assert.Equal("Contract HQ", named.GetProperty("progress").GetProperty("networkName").GetString());

        // address (skipped) → browserDeviceName: the save side effect creates
        // the org's network under the collected name.
        var addressSkipped = await TurnAsync(org, new { chipChoice = "skip" });
        Assert.Equal("browserDeviceName", addressSkipped.GetProperty("stepId").GetString());
        var networks = await _api.GetAsync("v1/networks", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, networks.Status);
        var network = Assert.Single(networks.Data.EnumerateArray());
        Assert.Equal("Contract HQ", network.GetProperty("name").GetString());

        // browserDeviceName → mobility: three chips, no fields.
        var browserNamed = await TurnAsync(org, new { fieldValues = new { name = "My Laptop" } });
        Assert.Equal("mobility", browserNamed.GetProperty("stepId").GetString());
        Assert.Equal(3, browserNamed.GetProperty("chips").GetArrayLength());

        var mobility = await TurnAsync(org, new { chipChoice = "HOME_ONLY" });
        Assert.Equal("confirmHomeIp", mobility.GetProperty("stepId").GetString());

        var homeIp = await TurnAsync(org, new { chipChoice = "no" });
        Assert.Equal("routerMac", homeIp.GetProperty("stepId").GetString());

        var router = await TurnAsync(org, new { chipChoice = "skip" });
        Assert.Equal("modemMac", router.GetProperty("stepId").GetString());

        var modem = await TurnAsync(org, new { chipChoice = "skip" });
        Assert.Equal("isp", modem.GetProperty("stepId").GetString());

        var isp = await TurnAsync(org, new { chipChoice = "skip" });
        Assert.Equal("speeds", isp.GetProperty("stepId").GetString());

        // speeds (skipped) → done, complete.
        var done = await TurnAsync(org, new { chipChoice = "skip" });
        Assert.Equal("done", done.GetProperty("stepId").GetString());
        Assert.True(done.GetProperty("complete").GetBoolean());

        // The wizard is spent: a fresh turn hits the durable completion marker.
        var again = await _api.PostAsync("v1/onboarding/turn", new { }, org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Conflict, again.Status);
        Assert.Equal("ONBOARD_002", again.ErrorCode);
    }

    [Fact]
    public async Task An_unrecognized_input_stays_on_the_current_step()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var start = await TurnAsync(org, new { });
        Assert.Equal("networkName", start.GetProperty("stepId").GetString());

        // The step wants a name field; a chip is not an answer.
        var wrongKind = await TurnAsync(org, new { chipChoice = "skip" });
        Assert.Equal("networkName", wrongKind.GetProperty("stepId").GetString());
    }

    [Fact]
    public async Task Skip_clears_the_in_flight_state_so_a_later_turn_restarts()
    {
        var org = await _fixture.ProvisionOrgAsync();

        await TurnAsync(org, new { });
        var named = await TurnAsync(org, new { fieldValues = new { name = "Abandoned" } });
        Assert.Equal("address", named.GetProperty("stepId").GetString());

        var skip = await _api.PostAsync("v1/onboarding/skip", new { }, org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, skip.Status);
        Assert.Equal(JsonValueKind.Null, skip.Data.ValueKind);

        // Not completed, no state: the wizard resumes from the top.
        var restart = await TurnAsync(org, new { });
        Assert.Equal("networkName", restart.GetProperty("stepId").GetString());
    }

    [Fact]
    public async Task Turn_is_role_gated_ORG_003_for_a_MEMBER()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var member = await OrgProvisioning.AddMemberAsync(_api, org);

        var response = await _api.PostAsync("v1/onboarding/turn", new { }, member.AsCookie());

        Assert.Equal(HttpStatusCode.Forbidden, response.Status);
        Assert.Equal("ORG_003", response.ErrorCode);
    }

    private async Task<JsonElement> TurnAsync(ProvisionedOrg org, object body)
    {
        var response = await _api.PostAsync("v1/onboarding/turn", body, org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, response.Status);
        return response.Data;
    }
}
