using NodeScope.ContractTests.Monitoring;

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

    [Fact]
    public async Task Device_focus_includes_live_visible_context_and_hides_foreign_devices()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var monitored = await MonitoringScaffold.MonitoredDeviceAsync(
            _fixture.Api,
            org.OwnerAuth,
            ip: "10.44.0.7");
        var deviceRead = await _fixture.Api.GetAsync(
            $"v1/devices/{monitored.DeviceId}",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, deviceRead.Status);
        var deviceName = deviceRead.Data.GetProperty("name").GetString()!;
        var ingestToken = await MonitoringScaffold.MintIngestTokenAsync(
            _fixture.Api,
            org.OwnerAuth);
        var ingest = await _fixture.Api.PostAsync(
            "v1/monitoring/ingest",
            new
            {
                checks = new[]
                {
                    new
                    {
                        deviceId = monitored.DeviceId,
                        ok = true,
                        latencyMs = 18.5,
                        source = "assistant-contract",
                    },
                },
            },
            MonitoringScaffold.IngestToken(ingestToken));
        Assert.Equal(HttpStatusCode.Accepted, ingest.Status);

        await using var ownerSocket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerAuth);
        await ownerSocket.EmitAsync(
            "v1:ai:message",
            new
            {
                content = "Troubleshoot this device",
                deviceId = monitored.DeviceId,
            });
        var focused = await ownerSocket.WaitForEventAsync("v1:ai:token");
        var focusedText = focused.GetProperty("token").GetString()!;
        Assert.Contains(deviceName, focusedText, StringComparison.Ordinal);
        Assert.Contains("10.44.0.7", focusedText, StringComparison.Ordinal);
        Assert.Contains("Current status: UP", focusedText, StringComparison.Ordinal);
        Assert.Contains("latency_ms", focusedText, StringComparison.Ordinal);

        var otherOrg = await _fixture.ProvisionOrgAsync();
        await using var foreignSocket = await RealtimeScaffold.ConnectReadyAsync(otherOrg.OwnerAuth);
        await foreignSocket.EmitAsync(
            "v1:ai:message",
            new
            {
                content = "Troubleshoot this device",
                deviceId = monitored.DeviceId,
            });
        var hidden = await foreignSocket.WaitForEventAsync("v1:ai:token");
        var hiddenText = hidden.GetProperty("token").GetString()!;
        Assert.Contains("unavailable in your current access scope", hiddenText, StringComparison.Ordinal);
        Assert.DoesNotContain(deviceName, hiddenText, StringComparison.Ordinal);
        Assert.DoesNotContain("10.44.0.7", hiddenText, StringComparison.Ordinal);
    }
}
