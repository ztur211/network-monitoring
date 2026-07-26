namespace NodeScope.ContractTests.Realtime;

/// <summary>
/// Contract for the AI streaming events in the graceful-degradation mode the contract
/// target deliberately runs in (AI_BASE_URL points at nothing). The streaming shape
/// must hold even with the provider down: the canned fallback arrives as a v1:ai:token
/// to the asker's user room, followed by a v1:ai:complete whose content matches what
/// was streamed, marked providerStatus 'unavailable' with zero tokens charged. The C#
/// port must degrade the same way - an unreachable provider is an answer, not an error.
/// </summary>
[Collection(ContractSuite.Name)]
public class AiRealtimeTests
{
    private readonly ContractApiFixture _fixture;

    public AiRealtimeTests(ContractApiFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task Ai_message_streams_the_fallback_then_completes_unavailable_when_the_provider_is_down()
    {
        var org = await _fixture.ProvisionOrgAsync();
        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerAuth);

        await socket.EmitAsync("v1:ai:message", new { content = "What does my network look like?" });

        var token = await socket.WaitForEventAsync("v1:ai:token");
        var conversationId = token.GetProperty("conversationId").GetString();
        Assert.False(string.IsNullOrEmpty(conversationId));
        var streamed = token.GetProperty("token").GetString();
        Assert.False(string.IsNullOrEmpty(streamed));

        var complete = await socket.WaitForEventAsync(
            "v1:ai:complete",
            p => p.TryGetProperty("conversationId", out var c) && c.GetString() == conversationId);
        // The fallback streams as ONE token carrying the whole answer, and complete
        // repeats it verbatim - the two surfaces must tell the same story.
        Assert.Equal(streamed, complete.GetProperty("content").GetString());
        Assert.Equal("unavailable", complete.GetProperty("providerStatus").GetString());
        Assert.Equal(0, complete.GetProperty("tokensUsed").GetInt32());
        Assert.Equal(JsonValueKind.Null, complete.GetProperty("usageWarning").ValueKind);
        Assert.True(complete.TryGetProperty("monthlyBudgetRemaining", out _));
        Assert.True(complete.TryGetProperty("timestamp", out _));
    }
}
