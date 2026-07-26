namespace NodeScope.ContractTests.Inventory;

/// <summary>
/// Contract for the device-connection CRUD envelopes (v1/device-connections) -
/// the realtime side already covered the events. A connection joins two distinct
/// devices (self is CONN_002, 422) exactly once (a repeat pair is CONN_003, 409).
/// The list is items/total with the UUID-validated ?deviceId filter, updates are
/// the changeset envelope with SYNC_001, and unknown/foreign connections are
/// CONN_001.
/// </summary>
[Collection(ContractSuite.Name)]
public class ConnectionsContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public ConnectionsContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Create_returns_the_connection_and_a_duplicate_pair_is_409_CONN_003()
    {
        var (org, _, deviceAId, deviceBId) = await TwoDevicesAsync();

        var create = await _api.PostAsync(
            "v1/device-connections",
            new { sourceDeviceId = deviceAId, targetDeviceId = deviceBId, connectionType = "ETHERNET" },
            org.OwnerAuth);

        Assert.Equal(HttpStatusCode.Created, create.Status);
        Assert.Equal(deviceAId, create.Data.GetProperty("sourceDeviceId").GetString());
        Assert.Equal(deviceBId, create.Data.GetProperty("targetDeviceId").GetString());
        Assert.Equal("ETHERNET", create.Data.GetProperty("connectionType").GetString());
        Assert.Equal(1, create.Data.GetProperty("version").GetInt32());

        // Uniqueness is the (source, target, type) triple - the same pair with the
        // same type conflicts, while a different type is a distinct link.
        var duplicate = await _api.PostAsync(
            "v1/device-connections",
            new { sourceDeviceId = deviceAId, targetDeviceId = deviceBId, connectionType = "ETHERNET" },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Conflict, duplicate.Status);
        Assert.Equal("CONN_003", duplicate.ErrorCode);

        var otherType = await _api.PostAsync(
            "v1/device-connections",
            new { sourceDeviceId = deviceAId, targetDeviceId = deviceBId, connectionType = "FIBER" },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, otherType.Status);
    }

    [Fact]
    public async Task Self_connection_is_422_CONN_002_and_a_missing_endpoint_DEVICE_001()
    {
        var (org, _, deviceAId, _) = await TwoDevicesAsync();

        var self = await _api.PostAsync(
            "v1/device-connections",
            new { sourceDeviceId = deviceAId, targetDeviceId = deviceAId, connectionType = "ETHERNET" },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, self.Status);
        Assert.Equal("CONN_002", self.ErrorCode);

        var missing = await _api.PostAsync(
            "v1/device-connections",
            new { sourceDeviceId = deviceAId, targetDeviceId = Guid.NewGuid().ToString(), connectionType = "ETHERNET" },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, missing.Status);
        Assert.Equal("DEVICE_001", missing.ErrorCode);
    }

    [Fact]
    public async Task List_pages_items_total_and_validates_the_device_filter()
    {
        var (org, site, deviceAId, deviceBId) = await TwoDevicesAsync();
        var deviceCId = InventoryScaffold.RequireId(
            await InventoryScaffold.CreateDeviceAsync(_api, org.OwnerAuth, site.NetworkId, site.SiteId));

        var create = await _api.PostAsync(
            "v1/device-connections",
            new { sourceDeviceId = deviceAId, targetDeviceId = deviceBId, connectionType = "WIFI" },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, create.Status);
        var connectionId = InventoryScaffold.RequireId(create.Data);

        var list = await _api.GetAsync("v1/device-connections", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, list.Status);
        Assert.Contains(
            list.Data.GetProperty("items").EnumerateArray(),
            c => c.GetProperty("id").GetString() == connectionId);
        Assert.True(list.Data.GetProperty("total").GetInt32() >= 1);

        var uninvolved = await _api.GetAsync($"v1/device-connections?deviceId={deviceCId}", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, uninvolved.Status);
        Assert.DoesNotContain(
            uninvolved.Data.GetProperty("items").EnumerateArray(),
            c => c.GetProperty("id").GetString() == connectionId);

        var invalid = await _api.GetAsync("v1/device-connections?deviceId=not-a-uuid", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.Status);
        Assert.Equal("GEN_001", invalid.ErrorCode);
    }

    [Fact]
    public async Task Patch_speaks_the_changeset_envelope_and_stale_baseVersion_is_SYNC_001()
    {
        var (org, connectionId) = await OrgWithConnectionAsync();

        var patch = await _api.PatchAsync(
            $"v1/device-connections/{connectionId}",
            new
            {
                baseVersion = 1,
                changes = new[] { new { field = "connectionType", oldValue = "ETHERNET", newValue = "FIBER" } },
            },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, patch.Status);
        Assert.Equal("FIBER", patch.Data.GetProperty("connectionType").GetString());
        Assert.Equal(2, patch.Data.GetProperty("version").GetInt32());

        var stale = await _api.PatchAsync(
            $"v1/device-connections/{connectionId}",
            new
            {
                baseVersion = 1,
                changes = new[] { new { field = "notes", oldValue = (string?)null, newValue = "Stale" } },
            },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Conflict, stale.Status);
        Assert.Equal("SYNC_001", stale.ErrorCode);
    }

    [Fact]
    public async Task Unknown_or_foreign_connection_is_404_CONN_001_and_delete_removes()
    {
        var (org, connectionId) = await OrgWithConnectionAsync();

        var unknown = await _api.PatchAsync(
            $"v1/device-connections/{Guid.NewGuid()}",
            new
            {
                baseVersion = 1,
                changes = new[] { new { field = "notes", oldValue = (string?)null, newValue = "x" } },
            },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, unknown.Status);
        Assert.Equal("CONN_001", unknown.ErrorCode);

        // Another org can neither see nor delete it.
        var orgB = await _fixture.ProvisionOrgAsync();
        var foreign = await _api.DeleteAsync($"v1/device-connections/{connectionId}", orgB.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, foreign.Status);
        Assert.Equal("CONN_001", foreign.ErrorCode);

        var delete = await _api.DeleteAsync($"v1/device-connections/{connectionId}", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, delete.Status);
        Assert.Equal(JsonValueKind.Null, delete.Data.ValueKind);

        var gone = await _api.DeleteAsync($"v1/device-connections/{connectionId}", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, gone.Status);
        Assert.Equal("CONN_001", gone.ErrorCode);
    }

    private async Task<(ProvisionedOrg Org, InventoryScaffold.CharteredSite Site, string DeviceAId, string DeviceBId)> TwoDevicesAsync()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerAuth);
        var deviceA = await InventoryScaffold.CreateDeviceAsync(_api, org.OwnerAuth, site.NetworkId, site.SiteId);
        var deviceB = await InventoryScaffold.CreateDeviceAsync(_api, org.OwnerAuth, site.NetworkId, site.SiteId);
        return (org, site, InventoryScaffold.RequireId(deviceA), InventoryScaffold.RequireId(deviceB));
    }

    private async Task<(ProvisionedOrg Org, string ConnectionId)> OrgWithConnectionAsync()
    {
        var (org, _, deviceAId, deviceBId) = await TwoDevicesAsync();
        var create = await _api.PostAsync(
            "v1/device-connections",
            new { sourceDeviceId = deviceAId, targetDeviceId = deviceBId, connectionType = "ETHERNET" },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, create.Status);
        return (org, InventoryScaffold.RequireId(create.Data));
    }
}
