using NodeScope.ContractTests.Inventory;

namespace NodeScope.ContractTests.Monitoring;

/// <summary>
/// Contract for the monitoring read side (Spec 7 / Spec A): the building device-status
/// snapshot, the bucketed metric series, the distinct metric names, and the status-event
/// history. The window rules are the load-bearing part - MON_001 rejects an inverted
/// range and MON_002 rejects a range/bucket pair that would materialize more than the
/// bucket cap, both as 400s, while a non-allow-listed bucket dies earlier in validation
/// as GEN_001. Visibility is invisible-not-forbidden: unknown, foreign-org, and
/// out-of-F3-scope devices are all the same DEVICE_001 404.
/// </summary>
[Collection(ContractSuite.Name)]
public class MonitoringReadContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public MonitoringReadContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task DeviceStatus_reports_UNKNOWN_with_null_fields_for_a_never_probed_device()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var monitored = await MonitoringScaffold.MonitoredDeviceAsync(_api, org.OwnerCookie);

        var status = await _api.GetAsync($"v1/buildings/{monitored.BuildingId}/device-status", org.OwnerCookie);

        Assert.Equal(HttpStatusCode.OK, status.Status);
        var row = Assert.Single(status.Data.EnumerateArray());
        Assert.Equal(monitored.DeviceId, row.GetProperty("deviceId").GetString());
        Assert.Equal("UNKNOWN", row.GetProperty("state").GetString());
        Assert.Equal(JsonValueKind.Null, row.GetProperty("latencyMs").ValueKind);
        Assert.Equal(JsonValueKind.Null, row.GetProperty("lastCheckAt").ValueKind);
        Assert.Equal(JsonValueKind.Null, row.GetProperty("lastOkAt").ValueKind);
        Assert.Equal(JsonValueKind.Null, row.GetProperty("lastChangeAt").ValueKind);
    }

    [Fact]
    public async Task Metrics_returns_bucketed_averages_for_ingested_checks()
    {
        var (org, monitored, token) = await IngestedDeviceAsync();
        await IngestCheckAsync(monitored.DeviceId, ok: true, token, latencyMs: 42);

        // Default window (last hour) and bucket (5 minutes): the fresh sample must land.
        var reachable = await _api.GetAsync(
            $"v1/devices/{monitored.DeviceId}/metrics?metric=reachable",
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, reachable.Status);
        var row = Assert.Single(reachable.Data.EnumerateArray());
        Assert.Equal(1, row.GetProperty("avg").GetDouble());
        Assert.True(row.TryGetProperty("bucket", out var bucket));
        Assert.False(string.IsNullOrEmpty(bucket.GetString()));

        // A check carrying latencyMs also writes the latency_ms series.
        var latency = await _api.GetAsync(
            $"v1/devices/{monitored.DeviceId}/metrics?metric=latency_ms",
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, latency.Status);
        var latencyRow = Assert.Single(latency.Data.EnumerateArray());
        Assert.Equal(42, latencyRow.GetProperty("avg").GetDouble());
    }

    [Fact]
    public async Task MetricNames_lists_the_series_the_ingest_wrote()
    {
        var (org, monitored, token) = await IngestedDeviceAsync();
        await IngestCheckAsync(monitored.DeviceId, ok: true, token, latencyMs: 42);

        var names = await _api.GetAsync($"v1/devices/{monitored.DeviceId}/metric-names", org.OwnerCookie);

        Assert.Equal(HttpStatusCode.OK, names.Status);
        var list = names.Data.EnumerateArray().Select(n => n.GetString()).ToList();
        Assert.Contains("reachable", list);
        Assert.Contains("latency_ms", list);
    }

    [Fact]
    public async Task StatusEvents_returns_transitions_newest_first_and_honors_limit()
    {
        var (org, monitored, token) = await IngestedDeviceAsync();

        // The anti-flap ladder writes exactly three transitions: UP, WARNING (first
        // failure), DOWN (third). The second failure is same-state and writes none.
        await IngestCheckAsync(monitored.DeviceId, ok: true, token);
        await IngestCheckAsync(monitored.DeviceId, ok: false, token);
        await IngestCheckAsync(monitored.DeviceId, ok: false, token);
        await IngestCheckAsync(monitored.DeviceId, ok: false, token);

        var events = await _api.GetAsync($"v1/devices/{monitored.DeviceId}/status-events", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, events.Status);
        var states = events.Data.EnumerateArray().Select(e => e.GetProperty("state").GetString()).ToList();
        Assert.Equal(["DOWN", "WARNING", "UP"], states);
        foreach (var evt in events.Data.EnumerateArray())
        {
            Assert.False(string.IsNullOrEmpty(evt.GetProperty("time").GetString()));
            Assert.False(string.IsNullOrEmpty(evt.GetProperty("source").GetString()));
        }

        var limited = await _api.GetAsync($"v1/devices/{monitored.DeviceId}/status-events?limit=2", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, limited.Status);
        Assert.Equal(2, limited.Data.GetArrayLength());
    }

    [Fact]
    public async Task Metrics_with_an_inverted_range_is_400_MON_001()
    {
        var (org, monitored, _) = await IngestedDeviceAsync();

        var response = await _api.GetAsync(
            $"v1/devices/{monitored.DeviceId}/metrics?metric=reachable" +
            "&from=2026-01-02T00:00:00.000Z&to=2026-01-01T00:00:00.000Z",
            org.OwnerCookie);

        Assert.Equal(HttpStatusCode.BadRequest, response.Status);
        Assert.Equal("MON_001", response.ErrorCode);
    }

    [Fact]
    public async Task Metrics_with_a_range_exceeding_the_bucket_cap_is_400_MON_002()
    {
        var (org, monitored, _) = await IngestedDeviceAsync();

        // 60 days of 30-second buckets = 172 800 rows, far past MAX_METRIC_BUCKETS (5 000).
        var response = await _api.GetAsync(
            $"v1/devices/{monitored.DeviceId}/metrics?metric=reachable" +
            "&from=2026-01-01T00:00:00.000Z&to=2026-03-01T00:00:00.000Z&bucket=30 seconds",
            org.OwnerCookie);

        Assert.Equal(HttpStatusCode.BadRequest, response.Status);
        Assert.Equal("MON_002", response.ErrorCode);
    }

    [Fact]
    public async Task Metrics_with_a_non_allow_listed_bucket_is_400_GEN_001()
    {
        var (org, monitored, _) = await IngestedDeviceAsync();

        // The bucket allow-list is validation, so it rejects BEFORE the window rules
        // (GEN_001, not MON_00x) - and before any device lookup.
        var response = await _api.GetAsync(
            $"v1/devices/{monitored.DeviceId}/metrics?metric=reachable&bucket=1 second",
            org.OwnerCookie);

        Assert.Equal(HttpStatusCode.BadRequest, response.Status);
        Assert.Equal("GEN_001", response.ErrorCode);
    }

    [Fact]
    public async Task Metrics_for_an_unknown_or_foreign_device_is_404_DEVICE_001()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var unknown = await _api.GetAsync(
            $"v1/devices/{Guid.NewGuid()}/metrics?metric=reachable",
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.NotFound, unknown.Status);
        Assert.Equal("DEVICE_001", unknown.ErrorCode);

        // A real device in another org must be indistinguishable from a missing one.
        var orgB = await _fixture.ProvisionOrgAsync();
        var monitoredB = await MonitoringScaffold.MonitoredDeviceAsync(_api, orgB.OwnerCookie);
        var foreign = await _api.GetAsync(
            $"v1/devices/{monitoredB.DeviceId}/metrics?metric=reachable",
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.NotFound, foreign.Status);
        Assert.Equal("DEVICE_001", foreign.ErrorCode);
    }

    [Fact]
    public async Task Metrics_is_invisible_to_an_out_of_scope_member_and_visible_once_granted()
    {
        var (org, monitored, token) = await IngestedDeviceAsync();
        await IngestCheckAsync(monitored.DeviceId, ok: true, token);
        var member = await OrgProvisioning.AddMemberAsync(_api, org);
        var memberId = await OrgMemberIdAsync(org, member.UserId);

        // F3: a MEMBER with no site grant cannot see the device - 404, not 403.
        var invisible = await _api.GetAsync(
            $"v1/devices/{monitored.DeviceId}/metrics?metric=reachable",
            member.AsCookie());
        Assert.Equal(HttpStatusCode.NotFound, invisible.Status);
        Assert.Equal("DEVICE_001", invisible.ErrorCode);

        // Granting the governing SITE puts the device's building in scope.
        var grant = await _api.PostAsync(
            $"v1/members/{memberId}/properties",
            new { propertyId = monitored.SiteId },
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Created, grant.Status);

        var visible = await _api.GetAsync(
            $"v1/devices/{monitored.DeviceId}/metrics?metric=reachable",
            member.AsCookie());
        Assert.Equal(HttpStatusCode.OK, visible.Status);
        Assert.Single(visible.Data.EnumerateArray());
    }

    /// <summary>A monitored device plus the org's ingest token - the arrange step every
    /// read test starts from.</summary>
    private async Task<(ProvisionedOrg Org, MonitoringScaffold.MonitoredDevice Device, string Token)> IngestedDeviceAsync()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var monitored = await MonitoringScaffold.MonitoredDeviceAsync(_api, org.OwnerCookie);
        var token = await MonitoringScaffold.MintIngestTokenAsync(_api, org.OwnerCookie);
        return (org, monitored, token);
    }

    private async Task IngestCheckAsync(string deviceId, bool ok, string ingestToken, int? latencyMs = null)
    {
        object check = latencyMs is null
            ? new { deviceId, ok }
            : new { deviceId, ok, latencyMs };
        var ingest = await _api.PostAsync(
            "v1/monitoring/ingest",
            new { checks = new[] { check } },
            MonitoringScaffold.IngestToken(ingestToken));
        Assert.Equal(HttpStatusCode.Accepted, ingest.Status);
    }

    private async Task<string> OrgMemberIdAsync(ProvisionedOrg org, string userId)
    {
        var list = await _api.GetAsync("v1/organizations/me/members", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, list.Status);
        var member = list.Data.EnumerateArray().Single(m => m.GetProperty("userId").GetString() == userId);
        return member.GetProperty("id").GetString()
            ?? throw new InvalidOperationException("members list entry carried no id");
    }
}
