namespace NodeScope.ContractTests.Monitoring;

/// <summary>
/// Contract for <c>/api/v1/monitoring/ingest</c> and its token mint at
/// <c>/api/v1/monitoring/ingest-token</c> - the agent-agnostic write path. Ingest is
/// @Public and authenticates on the token alone, accepting EITHER a per-agent
/// <c>x-agent-token</c> OR a per-org ingest token (as <c>x-ingest-token</c> or a
/// Bearer). The org is derived from the token, so a foreign-org deviceId fails the
/// whole batch with <c>ORG_008</c>. Covers both credential families, the token mint's
/// OWNER-only gate, the batch envelope, the round-trip into device-status, and the
/// three rejection axes: bad/absent token (<c>AUTH_002</c>), over-cap batch
/// (<c>GEN_005</c> / 413, the retryable signal), and a malformed item
/// (<c>GEN_001</c> / 400, the drop signal). Each test provisions its own isolated org.
/// </summary>
[Collection(ContractSuite.Name)]
public class IngestContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public IngestContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task MintIngestToken_as_owner_returns_a_token()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var response = await _api.PostAsync("v1/monitoring/ingest-token", auth: org.OwnerAuth);

        Assert.Equal(HttpStatusCode.Created, response.Status);
        Assert.False(string.IsNullOrEmpty(response.Data.GetProperty("token").GetString()));
    }

    [Fact]
    public async Task MintIngestToken_as_a_member_is_403_ORG_003()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var member = await OrgProvisioning.AddMemberAsync(_api, org);

        var response = await _api.PostAsync("v1/monitoring/ingest-token", auth: member.AsBearer());

        Assert.Equal(HttpStatusCode.Forbidden, response.Status);
        Assert.Equal("ORG_003", response.ErrorCode);
    }

    [Fact]
    public async Task MintIngestToken_without_authentication_is_401_AUTH_002()
    {
        var response = await _api.PostAsync("v1/monitoring/ingest-token");

        Assert.Equal(HttpStatusCode.Unauthorized, response.Status);
        Assert.Equal("AUTH_002", response.ErrorCode);
    }

    [Fact]
    public async Task Ingest_with_an_org_token_is_accepted_and_reflected_in_device_status()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var monitored = await MonitoringScaffold.MonitoredDeviceAsync(_api, org.OwnerAuth);
        var token = await MonitoringScaffold.MintIngestTokenAsync(_api, org.OwnerAuth);

        var ingest = await _api.PostAsync(
            "v1/monitoring/ingest",
            new { checks = new[] { new { deviceId = monitored.DeviceId, ok = true, latencyMs = 5 } } },
            MonitoringScaffold.IngestToken(token));

        Assert.Equal(HttpStatusCode.Accepted, ingest.Status);
        Assert.Equal(1, ingest.Data.GetProperty("accepted").GetInt32());

        // The write is observable through the owner's device-status read: the device is UP.
        var status = await _api.GetAsync($"v1/buildings/{monitored.BuildingId}/device-status", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, status.Status);
        var row = Assert.Single(
            status.Data.EnumerateArray(), d => d.GetProperty("deviceId").GetString() == monitored.DeviceId);
        Assert.Equal("UP", row.GetProperty("state").GetString());
    }

    [Fact]
    public async Task Ingest_accepts_the_org_token_as_a_bearer_credential()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var monitored = await MonitoringScaffold.MonitoredDeviceAsync(_api, org.OwnerAuth);
        var token = await MonitoringScaffold.MintIngestTokenAsync(_api, org.OwnerAuth);

        // The ingest guard falls back to Authorization: Bearer for the org token.
        var ingest = await _api.PostAsync(
            "v1/monitoring/ingest",
            new { checks = new[] { new { deviceId = monitored.DeviceId, ok = true } } },
            Auth.Bearer(token));

        Assert.Equal(HttpStatusCode.Accepted, ingest.Status);
        Assert.Equal(1, ingest.Data.GetProperty("accepted").GetInt32());
    }

    [Fact]
    public async Task Ingest_with_an_agent_token_is_accepted()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var monitored = await MonitoringScaffold.MonitoredDeviceAsync(_api, org.OwnerAuth);
        var agent = await MonitoringScaffold.EnrollAgentAsync(_api, org.OwnerAuth);

        var ingest = await _api.PostAsync(
            "v1/monitoring/ingest",
            new
            {
                metrics = new[] { new { deviceId = monitored.DeviceId, metric = "latency_ms", value = 7 } },
            },
            agent.AsAgentToken());

        Assert.Equal(HttpStatusCode.Accepted, ingest.Status);
        Assert.Equal(1, ingest.Data.GetProperty("accepted").GetInt32());
    }

    [Fact]
    public async Task Ingest_without_a_token_is_401_AUTH_002()
    {
        var response = await _api.PostAsync("v1/monitoring/ingest", new { checks = Array.Empty<object>() });

        Assert.Equal(HttpStatusCode.Unauthorized, response.Status);
        Assert.Equal("AUTH_002", response.ErrorCode);
    }

    [Fact]
    public async Task Ingest_with_an_invalid_token_is_401_AUTH_002()
    {
        var response = await _api.PostAsync(
            "v1/monitoring/ingest",
            new { checks = Array.Empty<object>() },
            MonitoringScaffold.IngestToken($"nope-{Guid.NewGuid():N}"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.Status);
        Assert.Equal("AUTH_002", response.ErrorCode);
    }

    [Fact]
    public async Task Ingest_of_a_device_in_another_org_is_404_ORG_008()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var token = await MonitoringScaffold.MintIngestTokenAsync(_api, org.OwnerAuth);

        // A device that belongs to a different org - the token must not be able to write it.
        var foreign = await _fixture.ProvisionOrgAsync();
        var foreignDevice = await MonitoringScaffold.MonitoredDeviceAsync(_api, foreign.OwnerAuth);

        var response = await _api.PostAsync(
            "v1/monitoring/ingest",
            new { checks = new[] { new { deviceId = foreignDevice.DeviceId, ok = true } } },
            MonitoringScaffold.IngestToken(token));

        Assert.Equal(HttpStatusCode.NotFound, response.Status);
        Assert.Equal("ORG_008", response.ErrorCode);
    }

    [Fact]
    public async Task Ingest_over_the_batch_cap_is_413_GEN_005()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var token = await MonitoringScaffold.MintIngestTokenAsync(_api, org.OwnerAuth);

        // 1001 > INGEST_MAX_CHECKS_PER_BATCH (1000). The batch-size guard runs before the
        // validation pipe, so an over-cap batch is a retryable 413 (split and retry), never
        // a 400 (which the agent would treat as a poison batch and drop). The deviceIds need
        // not exist: the guard rejects on count before any ownership check.
        var overCap = Enumerable.Range(0, 1001)
            .Select(i => new { deviceId = $"dev-{i}", ok = true })
            .ToArray();

        var response = await _api.PostAsync(
            "v1/monitoring/ingest",
            new { checks = overCap },
            MonitoringScaffold.IngestToken(token));

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.Status);
        Assert.Equal("GEN_005", response.ErrorCode);
    }

    [Fact]
    public async Task Ingest_with_a_malformed_item_is_400_GEN_001()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var token = await MonitoringScaffold.MintIngestTokenAsync(_api, org.OwnerAuth);

        // `ok` must be a boolean; a within-cap but malformed batch is a 400 (drop), the
        // deliberate counterpart to the over-cap 413 (retry).
        var response = await _api.PostAsync(
            "v1/monitoring/ingest",
            new { checks = new[] { new { deviceId = "some-device", ok = "yes" } } },
            MonitoringScaffold.IngestToken(token));

        Assert.Equal(HttpStatusCode.BadRequest, response.Status);
        Assert.Equal("GEN_001", response.ErrorCode);
    }
}
