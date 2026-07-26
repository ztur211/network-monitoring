using NodeScope.ContractTests.Monitoring;

namespace NodeScope.ContractTests.Realtime;

/// <summary>
/// Contract for the telemetry-driven events. device:status is edge-triggered: an ingest
/// emits only when it CHANGES the device's state (first check inclusive - UNKNOWN to UP
/// is a transition), and a same-state re-ingest is silent. Failures are anti-flapped:
/// below MONITORING_DOWN_THRESHOLD consecutive fails they surface as WARNING, and only
/// crossing the threshold hardens to DOWN. metrics:update is the pushed
/// half of the browser collector loop: a client submits over the socket, and a scheduled
/// per-org push returns each user's latest sample to their own user room (the contract
/// target runs REFRESH_INTERVAL_SECONDS=2 so a cycle is observable in test time).
/// </summary>
[Collection(ContractSuite.Name)]
public class MonitoringRealtimeTests
{
    private static readonly TimeSpan NegativeWindow = TimeSpan.FromSeconds(2);

    /// <summary>Two-plus push-scheduler cycles at the target's 2s cadence, with margin for
    /// a tick lost to the cycle-election lock straddling an interval boundary.</summary>
    private static readonly TimeSpan PushCycleWindow = TimeSpan.FromSeconds(15);

    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public MonitoringRealtimeTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Owner_socket_receives_device_status_on_state_transitions_but_not_same_state_ingests()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var monitored = await MonitoringScaffold.MonitoredDeviceAsync(_api, org.OwnerAuth);
        var token = await MonitoringScaffold.MintIngestTokenAsync(_api, org.OwnerAuth);

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerAuth);

        // First check ever: UNKNOWN -> UP is a transition, so it emits.
        await IngestCheckAsync(monitored.DeviceId, ok: true, token);
        var up = await socket.WaitForEventAsync("v1:device:status", p => DeviceIdIs(p, monitored.DeviceId));
        Assert.Equal("UP", up.GetProperty("state").GetString());
        Assert.True(up.TryGetProperty("at", out _));
        Assert.True(up.TryGetProperty("timestamp", out _));

        // Anti-flap: one failed check is a soft WARNING, not a hard DOWN.
        await IngestCheckAsync(monitored.DeviceId, ok: false, token);
        var warning = await socket.WaitForEventAsync("v1:device:status", p => DeviceIdIs(p, monitored.DeviceId));
        Assert.Equal("WARNING", warning.GetProperty("state").GetString());

        // Second consecutive failure: still below the down threshold, so still WARNING -
        // no transition, no event. device:status is edge-triggered.
        await IngestCheckAsync(monitored.DeviceId, ok: false, token);
        await Assert.ThrowsAsync<TimeoutException>(
            () => socket.WaitForEventAsync("v1:device:status", p => DeviceIdIs(p, monitored.DeviceId), NegativeWindow));

        // Third consecutive failure crosses MONITORING_DOWN_THRESHOLD (default 3): DOWN emits.
        await IngestCheckAsync(monitored.DeviceId, ok: false, token);
        var down = await socket.WaitForEventAsync("v1:device:status", p => DeviceIdIs(p, monitored.DeviceId));
        Assert.Equal("DOWN", down.GetProperty("state").GetString());
    }

    [Fact]
    public async Task Owner_socket_receives_metrics_update_with_its_latest_submitted_sample()
    {
        var org = await _fixture.ProvisionOrgAsync();
        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerAuth);

        await socket.EmitAsync("v1:metrics:submit", new
        {
            bandwidthDown = 123.5,
            bandwidthUp = 42.25,
            latency = 17.5,
            connectionQuality = "good",
        });

        // The push is scheduled, not request-coupled: the next per-org cycle returns the
        // submitter's latest sample to their own user room, tagged with its source.
        var evt = await socket.WaitForEventAsync("v1:metrics:update", timeout: PushCycleWindow);
        var metrics = evt.GetProperty("metrics");
        Assert.Equal(123.5, metrics.GetProperty("bandwidthDown").GetDouble());
        Assert.Equal(42.25, metrics.GetProperty("bandwidthUp").GetDouble());
        Assert.Equal(17.5, metrics.GetProperty("latency").GetDouble());
        Assert.Equal("good", metrics.GetProperty("connectionQuality").GetString());
        Assert.True(metrics.TryGetProperty("timestamp", out _));

        var sourceType = Assert.Single(evt.GetProperty("sourceTypes").EnumerateArray());
        Assert.Equal("browser", sourceType.GetString());
    }

    private static bool DeviceIdIs(JsonElement payload, string deviceId) =>
        payload.TryGetProperty("deviceId", out var d) && d.GetString() == deviceId;

    private async Task IngestCheckAsync(string deviceId, bool ok, string ingestToken)
    {
        var ingest = await _api.PostAsync(
            "v1/monitoring/ingest",
            new { checks = new[] { new { deviceId, ok } } },
            MonitoringScaffold.IngestToken(ingestToken));
        Assert.Equal(HttpStatusCode.Accepted, ingest.Status);
    }
}
