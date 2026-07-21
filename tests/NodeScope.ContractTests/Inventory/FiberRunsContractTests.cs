namespace NodeScope.ContractTests.Inventory;

/// <summary>
/// Contract for fiber-run CRUD (v1/fiber-runs). A run connects two DISTINCT
/// devices (the same device twice is FIBER_002, 422; a missing endpoint is
/// DEVICE_001). The list is a flat items/total page with an optional ?deviceId
/// filter that must be a UUID (GEN_001 otherwise). Updates speak the shared
/// changeset envelope with its SYNC_001 stale conflict, and unknown/foreign runs
/// are the same FIBER_001 404.
/// </summary>
[Collection(ContractSuite.Name)]
public class FiberRunsContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public FiberRunsContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Create_returns_the_run_and_list_filters_by_device()
    {
        var (org, site, deviceAId, deviceBId) = await TwoDevicesAsync();
        var deviceCId = InventoryScaffold.RequireId(
            await InventoryScaffold.CreateDeviceAsync(_api, org.OwnerCookie, site.NetworkId, site.SiteId));

        var create = await _api.PostAsync(
            "v1/fiber-runs",
            new
            {
                name = "Backbone A-B",
                startDeviceId = deviceAId,
                endDeviceId = deviceBId,
                cableType = "OS2",
                lengthMeters = 120.5,
            },
            org.OwnerCookie);

        Assert.Equal(HttpStatusCode.Created, create.Status);
        Assert.Equal("Backbone A-B", create.Data.GetProperty("name").GetString());
        Assert.Equal(deviceAId, create.Data.GetProperty("startDeviceId").GetString());
        Assert.Equal(deviceBId, create.Data.GetProperty("endDeviceId").GetString());
        Assert.Equal("OS2", create.Data.GetProperty("cableType").GetString());
        Assert.Equal(120.5, create.Data.GetProperty("lengthMeters").GetDouble());
        Assert.Equal(1, create.Data.GetProperty("version").GetInt32());
        var runId = create.Data.GetProperty("id").GetString();

        var list = await _api.GetAsync("v1/fiber-runs", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, list.Status);
        Assert.Contains(
            list.Data.GetProperty("items").EnumerateArray(),
            r => r.GetProperty("id").GetString() == runId);
        Assert.True(list.Data.GetProperty("total").GetInt32() >= 1);

        // Filtered by an uninvolved device the run must vanish.
        var filtered = await _api.GetAsync($"v1/fiber-runs?deviceId={deviceCId}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, filtered.Status);
        Assert.DoesNotContain(
            filtered.Data.GetProperty("items").EnumerateArray(),
            r => r.GetProperty("id").GetString() == runId);

        var involving = await _api.GetAsync($"v1/fiber-runs?deviceId={deviceAId}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, involving.Status);
        Assert.Contains(
            involving.Data.GetProperty("items").EnumerateArray(),
            r => r.GetProperty("id").GetString() == runId);
    }

    [Fact]
    public async Task A_non_uuid_deviceId_filter_is_400_GEN_001()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var response = await _api.GetAsync("v1/fiber-runs?deviceId=not-a-uuid", org.OwnerCookie);

        Assert.Equal(HttpStatusCode.BadRequest, response.Status);
        Assert.Equal("GEN_001", response.ErrorCode);
    }

    [Fact]
    public async Task Both_endpoints_must_exist_and_differ()
    {
        var (org, _, deviceAId, _) = await TwoDevicesAsync();

        var same = await _api.PostAsync(
            "v1/fiber-runs",
            new { name = "Loop", startDeviceId = deviceAId, endDeviceId = deviceAId },
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, same.Status);
        Assert.Equal("FIBER_002", same.ErrorCode);

        var missing = await _api.PostAsync(
            "v1/fiber-runs",
            new { name = "Dangling", startDeviceId = deviceAId, endDeviceId = Guid.NewGuid().ToString() },
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.NotFound, missing.Status);
        Assert.Equal("DEVICE_001", missing.ErrorCode);
    }

    [Fact]
    public async Task Get_unknown_or_foreign_run_is_404_FIBER_001()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var unknown = await _api.GetAsync($"v1/fiber-runs/{Guid.NewGuid()}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.NotFound, unknown.Status);
        Assert.Equal("FIBER_001", unknown.ErrorCode);

        var (orgB, runBId) = await OrgWithRunAsync();
        _ = orgB;
        var foreign = await _api.GetAsync($"v1/fiber-runs/{runBId}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.NotFound, foreign.Status);
        Assert.Equal("FIBER_001", foreign.ErrorCode);
    }

    [Fact]
    public async Task Patch_speaks_the_changeset_envelope_and_stale_baseVersion_is_SYNC_001()
    {
        var (org, runId) = await OrgWithRunAsync();

        var get = await _api.GetAsync($"v1/fiber-runs/{runId}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, get.Status);
        var baseVersion = get.Data.GetProperty("version").GetInt32();

        var patch = await _api.PatchAsync(
            $"v1/fiber-runs/{runId}",
            new
            {
                baseVersion,
                changes = new[] { new { field = "notes", oldValue = (string?)null, newValue = "Spliced at MDF" } },
            },
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, patch.Status);
        Assert.Equal("Spliced at MDF", patch.Data.GetProperty("notes").GetString());
        Assert.Equal(baseVersion + 1, patch.Data.GetProperty("version").GetInt32());

        var stale = await _api.PatchAsync(
            $"v1/fiber-runs/{runId}",
            new
            {
                baseVersion,
                changes = new[] { new { field = "notes", oldValue = (string?)null, newValue = "Stale" } },
            },
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Conflict, stale.Status);
        Assert.Equal("SYNC_001", stale.ErrorCode);
    }

    [Fact]
    public async Task Delete_returns_null_data_and_the_run_is_gone()
    {
        var (org, runId) = await OrgWithRunAsync();

        var delete = await _api.DeleteAsync($"v1/fiber-runs/{runId}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, delete.Status);
        Assert.Equal(JsonValueKind.Null, delete.Data.ValueKind);

        var gone = await _api.GetAsync($"v1/fiber-runs/{runId}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.NotFound, gone.Status);
        Assert.Equal("FIBER_001", gone.ErrorCode);
    }

    /// <summary>A chartered site with two devices - the minimum a fiber run needs.</summary>
    private async Task<(ProvisionedOrg Org, InventoryScaffold.CharteredSite Site, string DeviceAId, string DeviceBId)> TwoDevicesAsync()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerCookie);
        var deviceA = await InventoryScaffold.CreateDeviceAsync(_api, org.OwnerCookie, site.NetworkId, site.SiteId);
        var deviceB = await InventoryScaffold.CreateDeviceAsync(_api, org.OwnerCookie, site.NetworkId, site.SiteId);
        return (org, site, InventoryScaffold.RequireId(deviceA), InventoryScaffold.RequireId(deviceB));
    }

    private async Task<(ProvisionedOrg Org, string RunId)> OrgWithRunAsync()
    {
        var (org, _, deviceAId, deviceBId) = await TwoDevicesAsync();
        var create = await _api.PostAsync(
            "v1/fiber-runs",
            new { name = $"run-{Guid.NewGuid():N}", startDeviceId = deviceAId, endDeviceId = deviceBId },
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Created, create.Status);
        return (org, InventoryScaffold.RequireId(create.Data));
    }
}
