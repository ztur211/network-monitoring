namespace NodeScope.ContractTests.Realtime;

/// <summary>
/// Contract for the onboarding turn event. Each POST to the turn endpoint advances the
/// owner's onboarding state machine and announces the step transition to the whole org
/// room as <c>{stepId, complete}</c> - the payload mirrors the HTTP response's own
/// stepId/complete pair, so both surfaces must tell the same story.
/// </summary>
[Collection(ContractSuite.Name)]
public class OnboardingRealtimeTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public OnboardingRealtimeTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Org_room_receives_onboarding_turn_when_the_owner_advances_onboarding()
    {
        var org = await _fixture.ProvisionOrgAsync();
        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerAuth);

        var turn = await _api.PostAsync("v1/onboarding/turn", new { }, org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, turn.Status);
        var stepId = turn.Data.GetProperty("stepId").GetString();
        Assert.False(string.IsNullOrEmpty(stepId));
        var complete = turn.Data.GetProperty("complete").GetBoolean();

        var evt = await socket.WaitForEventAsync(
            "v1:onboarding:turn",
            p => p.TryGetProperty("stepId", out var s) && s.GetString() == stepId);
        Assert.Equal(complete, evt.GetProperty("complete").GetBoolean());
        Assert.True(evt.TryGetProperty("timestamp", out _));
    }
}
