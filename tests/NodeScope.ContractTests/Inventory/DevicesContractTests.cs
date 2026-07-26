namespace NodeScope.ContractTests.Inventory;

/// <summary>
/// Contract for <c>/api/v1/devices</c> - the inventory's leaf records, and the
/// endpoint the whole per-test-org scaffolding exists to reach. Covers the placement
/// rule (a device may only sit at or under one of its network's chartered sites, else
/// <c>PROP_007</c>), org-wide case-insensitive name uniqueness (<c>ORG_005</c>), the
/// paginated list plus its building-scoped bare-array variant, name suggestion, the
/// CRUD envelope, optimistic-concurrency conflict, and the auth/org gates. Each test
/// provisions its own isolated org and charters a fresh site to place devices on.
/// </summary>
[Collection(ContractSuite.Name)]
public class DevicesContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public DevicesContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task CreateDevice_on_a_chartered_site_returns_the_device_at_version_one()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var scaffold = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerAuth);

        var response = await _api.PostAsync(
            "v1/devices",
            new { name = "core-sw-01", category = "SWITCH", networkId = scaffold.NetworkId, propertyId = scaffold.SiteId },
            org.OwnerAuth);

        Assert.Equal(HttpStatusCode.Created, response.Status);
        var device = response.Data;
        Assert.False(string.IsNullOrEmpty(device.GetProperty("id").GetString()));
        Assert.Equal("core-sw-01", device.GetProperty("name").GetString());
        Assert.Equal("SWITCH", device.GetProperty("category").GetString());
        Assert.Equal(scaffold.NetworkId, device.GetProperty("networkId").GetString());
        Assert.Equal(scaffold.SiteId, device.GetProperty("propertyId").GetString());
        Assert.Equal(1, device.GetProperty("version").GetInt32());
    }

    [Fact]
    public async Task CreateDevice_on_an_uncharted_site_is_422_PROP_007()
    {
        var org = await _fixture.ProvisionOrgAsync();
        // A site and a network, but deliberately no charter binding them.
        var site = await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerAuth, "SITE");
        var siteId = InventoryScaffold.RequireId(site);
        var network = await InventoryScaffold.CreateNetworkAsync(_api, org.OwnerAuth);
        var networkId = InventoryScaffold.RequireId(network);

        var response = await _api.PostAsync(
            "v1/devices",
            new { name = "orphan-sw", category = "SWITCH", networkId, propertyId = siteId },
            org.OwnerAuth);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.Status);
        Assert.Equal("PROP_007", response.ErrorCode);
    }

    [Fact]
    public async Task CreateDevice_with_a_name_that_differs_only_in_case_is_409_ORG_005()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var scaffold = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerAuth);
        await InventoryScaffold.CreateDeviceAsync(_api, org.OwnerAuth, scaffold.NetworkId, scaffold.SiteId, name: "Edge-Router");

        var clash = await _api.PostAsync(
            "v1/devices",
            new { name = "edge-router", category = "ROUTER", networkId = scaffold.NetworkId, propertyId = scaffold.SiteId },
            org.OwnerAuth);

        Assert.Equal(HttpStatusCode.Conflict, clash.Status);
        Assert.Equal("ORG_005", clash.ErrorCode);
    }

    [Fact]
    public async Task ListDevices_is_paginated_and_counts_the_created_device()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var scaffold = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerAuth);
        var device = await InventoryScaffold.CreateDeviceAsync(_api, org.OwnerAuth, scaffold.NetworkId, scaffold.SiteId);
        var deviceId = InventoryScaffold.RequireId(device);

        var list = await _api.GetAsync("v1/devices", org.OwnerAuth);

        Assert.Equal(HttpStatusCode.OK, list.Status);
        Assert.Equal(JsonValueKind.Array, list.Data.GetProperty("items").ValueKind);
        Assert.True(list.Data.GetProperty("total").GetInt32() >= 1);
        Assert.Contains(list.Data.GetProperty("items").EnumerateArray(), d => d.GetProperty("id").GetString() == deviceId);
    }

    [Fact]
    public async Task ListDevices_scoped_to_a_building_returns_a_bare_array()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var scaffold = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerAuth);
        var device = await InventoryScaffold.CreateDeviceAsync(_api, org.OwnerAuth, scaffold.NetworkId, scaffold.SiteId);
        var deviceId = InventoryScaffold.RequireId(device);

        // ?buildingPropertyId scopes to a subtree and returns a bare array, not the {items,total} page.
        var scoped = await _api.GetAsync($"v1/devices?buildingPropertyId={scaffold.SiteId}", org.OwnerAuth);

        Assert.Equal(HttpStatusCode.OK, scoped.Status);
        Assert.Equal(JsonValueKind.Array, scoped.Data.ValueKind);
        Assert.Contains(scoped.Data.EnumerateArray(), d => d.GetProperty("id").GetString() == deviceId);
    }

    [Fact]
    public async Task GetDevice_returns_the_device_and_unknown_ids_are_404_DEVICE_001()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var scaffold = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerAuth);
        var device = await InventoryScaffold.CreateDeviceAsync(_api, org.OwnerAuth, scaffold.NetworkId, scaffold.SiteId);
        var deviceId = InventoryScaffold.RequireId(device);

        var found = await _api.GetAsync($"v1/devices/{deviceId}", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, found.Status);
        Assert.Equal(deviceId, found.Data.GetProperty("id").GetString());

        var missing = await _api.GetAsync($"v1/devices/{Guid.NewGuid()}", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, missing.Status);
        Assert.Equal("DEVICE_001", missing.ErrorCode);
    }

    [Fact]
    public async Task NameSuggestion_returns_a_suggested_name_field()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var scaffold = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerAuth);

        var response = await _api.GetAsync(
            $"v1/devices/name-suggestion?propertyId={scaffold.SiteId}&category=SWITCH",
            org.OwnerAuth);

        Assert.Equal(HttpStatusCode.OK, response.Status);
        // The suggestion may be a string or null depending on naming template, but the
        // field is always present in the envelope.
        Assert.True(response.Data.TryGetProperty("suggestedName", out var suggested));
        Assert.Contains(suggested.ValueKind, new[] { JsonValueKind.String, JsonValueKind.Null });
    }

    [Fact]
    public async Task PatchDevice_renames_and_bumps_the_version()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var scaffold = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerAuth);
        var device = await InventoryScaffold.CreateDeviceAsync(_api, org.OwnerAuth, scaffold.NetworkId, scaffold.SiteId);
        var deviceId = InventoryScaffold.RequireId(device);
        var baseVersion = device.GetProperty("version").GetInt32();
        var newName = $"renamed-{Guid.NewGuid():N}";

        var patch = await _api.PatchAsync(
            $"v1/devices/{deviceId}",
            new
            {
                baseVersion,
                changes = new[] { new { field = "name", oldValue = (string?)null, newValue = newName } },
            },
            org.OwnerAuth);

        Assert.Equal(HttpStatusCode.OK, patch.Status);
        Assert.Equal(newName, patch.Data.GetProperty("name").GetString());
        Assert.Equal(baseVersion + 1, patch.Data.GetProperty("version").GetInt32());
    }

    [Fact]
    public async Task PatchDevice_with_a_stale_base_version_is_409_SYNC_001()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var scaffold = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerAuth);
        var device = await InventoryScaffold.CreateDeviceAsync(_api, org.OwnerAuth, scaffold.NetworkId, scaffold.SiteId);
        var deviceId = InventoryScaffold.RequireId(device);
        var baseVersion = device.GetProperty("version").GetInt32();

        var first = await _api.PatchAsync(
            $"v1/devices/{deviceId}",
            new
            {
                baseVersion,
                changes = new[] { new { field = "notes", oldValue = (string?)null, newValue = "First" } },
            },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, first.Status);

        var stale = await _api.PatchAsync(
            $"v1/devices/{deviceId}",
            new
            {
                baseVersion,
                changes = new[] { new { field = "notes", oldValue = (string?)null, newValue = "Second" } },
            },
            org.OwnerAuth);

        Assert.Equal(HttpStatusCode.Conflict, stale.Status);
        Assert.Equal("SYNC_001", stale.ErrorCode);
    }

    [Fact]
    public async Task DeleteDevice_succeeds_and_a_second_delete_is_404_DEVICE_001()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var scaffold = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerAuth);
        var device = await InventoryScaffold.CreateDeviceAsync(_api, org.OwnerAuth, scaffold.NetworkId, scaffold.SiteId);
        var deviceId = InventoryScaffold.RequireId(device);

        var deleted = await _api.DeleteAsync($"v1/devices/{deviceId}", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, deleted.Status);
        Assert.Equal(JsonValueKind.Null, deleted.Data.ValueKind);

        var again = await _api.DeleteAsync($"v1/devices/{deviceId}", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, again.Status);
        Assert.Equal("DEVICE_001", again.ErrorCode);
    }

    [Fact]
    public async Task ListDevices_for_a_user_with_no_org_is_403_ORG_002()
    {
        var loner = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.GetAsync("v1/devices", loner.AsBearer());

        Assert.Equal(HttpStatusCode.Forbidden, response.Status);
        Assert.Equal("ORG_002", response.ErrorCode);
    }

    [Fact]
    public async Task ListDevices_without_authentication_is_401_AUTH_002()
    {
        var response = await _api.GetAsync("v1/devices");

        Assert.Equal(HttpStatusCode.Unauthorized, response.Status);
        Assert.Equal("AUTH_002", response.ErrorCode);
    }
}
