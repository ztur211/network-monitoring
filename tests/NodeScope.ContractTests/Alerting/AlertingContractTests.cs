using NodeScope.Contracts.Realtime;
using NodeScope.ContractTests.Monitoring;
using NodeScope.ContractTests.Realtime;

namespace NodeScope.ContractTests.Alerting;

/// <summary>
/// Black-box contract for alert administration, tenant isolation, durable
/// state-transition evaluation, and admin-only realtime delivery.
/// </summary>
[Collection(ContractSuite.Name)]
public class AlertingContractTests
{
    private static readonly TimeSpan DeliveryWindow = TimeSpan.FromSeconds(25);
    private static readonly TimeSpan NegativeWindow = TimeSpan.FromSeconds(2);

    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public AlertingContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Alert_resources_are_admin_gated_org_scoped_secret_redacted_and_restrict_channel_delete()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var other = await _fixture.ProvisionOrgAsync();
        var member = await OrgProvisioning.AddMemberAsync(_api, org);
        const string secret = "contract-webhook-secret";

        var created = await _api.PostAsync(
            "v1/alerts/channels",
            new
            {
                type = "WEBHOOK",
                name = "Contract webhook",
                config = new { url = "https://example.test/nodescope" },
                secret,
            },
            org.OwnerAuth);

        Assert.Equal(HttpStatusCode.Created, created.Status);
        var channelId = RequireId(created.Data);
        Assert.Equal(org.OrganizationId, created.Data.GetProperty("organizationId").GetString());
        Assert.Equal("WEBHOOK", created.Data.GetProperty("type").GetString());
        Assert.False(created.Data.TryGetProperty("secret", out _));
        Assert.False(created.Data.TryGetProperty("secretEnc", out _));
        Assert.DoesNotContain(secret, created.Body, StringComparison.Ordinal);

        var list = await _api.GetAsync("v1/alerts/channels", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, list.Status);
        var listed = Assert.Single(list.Data.EnumerateArray());
        Assert.Equal(channelId, RequireId(listed));
        Assert.DoesNotContain(secret, list.Body, StringComparison.Ordinal);

        var memberList = await _api.GetAsync("v1/alerts/channels", member.AsBearer());
        Assert.Equal(HttpStatusCode.Forbidden, memberList.Status);
        Assert.Equal("ORG_003", memberList.ErrorCode);

        var otherList = await _api.GetAsync("v1/alerts/channels", other.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, otherList.Status);
        Assert.Empty(otherList.Data.EnumerateArray());

        var foreignDelete = await _api.DeleteAsync(
            $"v1/alerts/channels/{channelId}",
            other.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, foreignDelete.Status);
        Assert.Equal("ALERT_003", foreignDelete.ErrorCode);

        var rule = await CreateStateRuleAsync(org, channelId, ["DOWN"]);
        var ruleId = RequireId(rule.Data);

        var channelInUse = await _api.DeleteAsync(
            $"v1/alerts/channels/{channelId}",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Conflict, channelInUse.Status);
        Assert.Equal("ALERT_002", channelInUse.ErrorCode);

        var deleteRule = await _api.DeleteAsync($"v1/alerts/rules/{ruleId}", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, deleteRule.Status);
        var deleteChannel = await _api.DeleteAsync(
            $"v1/alerts/channels/{channelId}",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, deleteChannel.Status);
    }

    [Fact]
    public async Task In_app_channel_test_reaches_admins_but_not_members()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var member = await OrgProvisioning.AddMemberAsync(_api, org);
        var channel = await CreateInAppChannelAsync(org);
        var channelId = RequireId(channel.Data);

        await using var ownerSocket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerAuth);
        await using var memberSocket = await RealtimeScaffold.ConnectReadyAsync(member.AsBearer());

        var sent = await _api.PostAsync(
            $"v1/alerts/channels/{channelId}/test",
            auth: org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, sent.Status);
        Assert.True(sent.Data.GetProperty("sent").GetBoolean());

        var ownerEvent = await ownerSocket.WaitForEventAsync(WsEvents.AlertFired);
        Assert.Equal("test", ownerEvent.GetProperty("id").GetString());
        Assert.Equal("Test notification", ownerEvent.GetProperty("ruleName").GetString());
        Assert.Equal("INFO", ownerEvent.GetProperty("severity").GetString());

        await Assert.ThrowsAsync<TimeoutException>(
            () => memberSocket.WaitForEventAsync(
                WsEvents.AlertFired,
                timeout: NegativeWindow));
    }

    [Fact]
    public async Task Unreachable_channel_test_returns_stable_gateway_error()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var channel = await _api.PostAsync(
            "v1/alerts/channels",
            new
            {
                type = "WEBHOOK",
                name = "Unreachable webhook",
                config = new { url = "http://127.0.0.1:1/nodescope" },
            },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, channel.Status);

        var response = await _api.PostAsync(
            $"v1/alerts/channels/{RequireId(channel.Data)}/test",
            auth: org.OwnerAuth);

        Assert.Equal(HttpStatusCode.BadGateway, response.Status);
        Assert.Equal("ALERT_007", response.ErrorCode);
    }

    [Fact]
    public async Task Monitoring_transition_records_and_delivers_one_firing_and_one_recovery()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var monitored = await MonitoringScaffold.MonitoredDeviceAsync(_api, org.OwnerAuth);
        var ingestToken = await MonitoringScaffold.MintIngestTokenAsync(_api, org.OwnerAuth);

        await IngestCheckAsync(monitored.DeviceId, ok: true, ingestToken);

        var channel = await CreateInAppChannelAsync(org);
        var rule = await CreateStateRuleAsync(
            org,
            RequireId(channel.Data),
            ["WARNING"],
            notifyOnRecovery: true);
        var ruleId = RequireId(rule.Data);

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerAuth);

        await IngestCheckAsync(monitored.DeviceId, ok: false, ingestToken);

        var firing = await WaitForHistoryEventAsync(
            org.OwnerAuth,
            ruleId,
            monitored.DeviceId,
            "FIRING");
        Assert.Equal("WARNING", firing.GetProperty("detail").GetProperty("state").GetString());
        var liveFiring = await socket.WaitForEventAsync(
            WsEvents.AlertFired,
            payload => EventMatches(payload, ruleId, monitored.DeviceId),
            DeliveryWindow);
        Assert.Equal("CRITICAL", liveFiring.GetProperty("severity").GetString());

        await IngestCheckAsync(monitored.DeviceId, ok: true, ingestToken);

        var resolved = await WaitForHistoryEventAsync(
            org.OwnerAuth,
            ruleId,
            monitored.DeviceId,
            "RESOLVED");
        Assert.Equal("UP", resolved.GetProperty("detail").GetProperty("state").GetString());
        _ = await socket.WaitForEventAsync(
            WsEvents.AlertResolved,
            payload => EventMatches(payload, ruleId, monitored.DeviceId),
            DeliveryWindow);

        var history = await _api.GetAsync("v1/alerts/events?limit=200", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, history.Status);
        var matching = history.Data.EnumerateArray()
            .Where(alertEvent =>
                alertEvent.GetProperty("ruleId").GetString() == ruleId
                && alertEvent.GetProperty("deviceId").GetString() == monitored.DeviceId)
            .ToList();
        Assert.Equal(2, matching.Count);

        var deleteRule = await _api.DeleteAsync($"v1/alerts/rules/{ruleId}", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, deleteRule.Status);
        var deleteChannel = await _api.DeleteAsync(
            $"v1/alerts/channels/{RequireId(channel.Data)}",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, deleteChannel.Status);

        var retainedHistory = await _api.GetAsync("v1/alerts/events?limit=200", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, retainedHistory.Status);
        Assert.Equal(
            2,
            retainedHistory.Data.EnumerateArray().Count(
                alertEvent => alertEvent.GetProperty("deviceId").GetString() == monitored.DeviceId
                    && alertEvent.GetProperty("ruleName").GetString()
                        == rule.Data.GetProperty("name").GetString()));
    }

    [Fact]
    public async Task Metric_threshold_requires_samples_spanning_the_configured_duration()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var monitored = await MonitoringScaffold.MonitoredDeviceAsync(_api, org.OwnerAuth);
        var ingestToken = await MonitoringScaffold.MintIngestTokenAsync(_api, org.OwnerAuth);
        var channel = await CreateInAppChannelAsync(org);
        var rule = await CreateMetricRuleAsync(org, RequireId(channel.Data));
        var ruleId = RequireId(rule.Data);

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerAuth);

        await IngestCheckAsync(monitored.DeviceId, ok: true, ingestToken, latencyMs: 500);

        await Assert.ThrowsAsync<TimeoutException>(
            () => socket.WaitForEventAsync(
                WsEvents.AlertFired,
                payload => EventMatches(payload, ruleId, monitored.DeviceId),
                TimeSpan.FromMilliseconds(1500)));

        for (var sample = 0; sample < 3; sample++)
        {
            await Task.Delay(1100);
            await IngestCheckAsync(monitored.DeviceId, ok: true, ingestToken, latencyMs: 500);
        }

        var firing = await socket.WaitForEventAsync(
            WsEvents.AlertFired,
            payload => EventMatches(payload, ruleId, monitored.DeviceId),
            DeliveryWindow);
        Assert.Equal("CRITICAL", firing.GetProperty("severity").GetString());

        var history = await WaitForHistoryEventAsync(
            org.OwnerAuth,
            ruleId,
            monitored.DeviceId,
            "FIRING");
        Assert.Equal(500, history.GetProperty("detail").GetProperty("value").GetDouble());
    }

    private async Task<ApiResponse> CreateInAppChannelAsync(ProvisionedOrg org)
    {
        var response = await _api.PostAsync(
            "v1/alerts/channels",
            new
            {
                type = "INAPP",
                name = $"In-app {Guid.NewGuid():N}",
                config = new { },
            },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, response.Status);
        return response;
    }

    private async Task<ApiResponse> CreateStateRuleAsync(
        ProvisionedOrg org,
        string channelId,
        IReadOnlyList<string> targetStates,
        bool notifyOnRecovery = false)
    {
        var response = await _api.PostAsync(
            "v1/alerts/rules",
            new
            {
                name = $"State rule {Guid.NewGuid():N}",
                trigger = "STATE_TRANSITION",
                scope = new { all = true },
                targetStates,
                severity = "CRITICAL",
                channelIds = new[] { channelId },
                cooldownSeconds = 0,
                notifyOnRecovery,
            },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, response.Status);
        return response;
    }

    private async Task<ApiResponse> CreateMetricRuleAsync(ProvisionedOrg org, string channelId)
    {
        var response = await _api.PostAsync(
            "v1/alerts/rules",
            new
            {
                name = $"Metric rule {Guid.NewGuid():N}",
                trigger = "METRIC_THRESHOLD",
                scope = new { all = true },
                metric = "latencyMs",
                op = "gt",
                threshold = 100,
                forSeconds = 3,
                severity = "CRITICAL",
                channelIds = new[] { channelId },
                cooldownSeconds = 0,
                notifyOnRecovery = true,
            },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, response.Status);
        return response;
    }

    private async Task IngestCheckAsync(
        string deviceId,
        bool ok,
        string ingestToken,
        int latencyMs = 5)
    {
        var response = await _api.PostAsync(
            "v1/monitoring/ingest",
            new { checks = new[] { new { deviceId, ok, latencyMs } } },
            MonitoringScaffold.IngestToken(ingestToken));
        Assert.Equal(HttpStatusCode.Accepted, response.Status);
    }

    private async Task<JsonElement> WaitForHistoryEventAsync(
        Auth auth,
        string ruleId,
        string deviceId,
        string kind)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        do
        {
            var response = await _api.GetAsync("v1/alerts/events?limit=200", auth);
            Assert.Equal(HttpStatusCode.OK, response.Status);
            foreach (var alertEvent in response.Data.EnumerateArray())
            {
                if (alertEvent.GetProperty("ruleId").GetString() == ruleId
                    && alertEvent.GetProperty("deviceId").GetString() == deviceId
                    && alertEvent.GetProperty("kind").GetString() == kind)
                {
                    return alertEvent;
                }
            }

            await Task.Delay(100);
        }
        while (DateTime.UtcNow < deadline);

        throw new TimeoutException(
            $"Timed out waiting for {kind} alert history for rule {ruleId} and device {deviceId}.");
    }

    private static bool EventMatches(JsonElement payload, string ruleId, string deviceId) =>
        payload.GetProperty("ruleId").GetString() == ruleId
        && payload.GetProperty("deviceId").GetString() == deviceId;

    private static string RequireId(JsonElement value) =>
        value.GetProperty("id").GetString()
        ?? throw new InvalidOperationException("Response carried no id.");
}
