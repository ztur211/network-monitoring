namespace NodeScope.ContractTests.Inventory;

/// <summary>
/// Contract for the network charter surface (v1/networks/:networkId/properties)
/// beyond the add/remove happy paths: the list read ({id, networkId, propertyId}
/// rows), the PROP_006 duplicate-charter conflict, PROP_001 for an unknown
/// property (add) or a non-chartered one (remove), and the load-bearing removal
/// guard - a charter still governing devices cannot be dropped (PROP_008, 409),
/// which is what makes the device-placement invariant permanent.
/// </summary>
[Collection(ContractSuite.Name)]
public class NetworkPropertyContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public NetworkPropertyContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task List_returns_the_charter_rows()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerCookie);

        var list = await _api.GetAsync($"v1/networks/{site.NetworkId}/properties", org.OwnerCookie);

        Assert.Equal(HttpStatusCode.OK, list.Status);
        var row = Assert.Single(list.Data.EnumerateArray());
        Assert.False(string.IsNullOrEmpty(row.GetProperty("id").GetString()));
        Assert.Equal(site.NetworkId, row.GetProperty("networkId").GetString());
        Assert.Equal(site.SiteId, row.GetProperty("propertyId").GetString());
    }

    [Fact]
    public async Task Chartering_the_same_site_twice_is_409_PROP_006()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerCookie);

        var duplicate = await _api.PostAsync(
            $"v1/networks/{site.NetworkId}/properties",
            new { propertyId = site.SiteId },
            org.OwnerCookie);

        Assert.Equal(HttpStatusCode.Conflict, duplicate.Status);
        Assert.Equal("PROP_006", duplicate.ErrorCode);
    }

    [Fact]
    public async Task Chartering_an_unknown_property_is_404_PROP_001()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerCookie);

        var response = await _api.PostAsync(
            $"v1/networks/{site.NetworkId}/properties",
            new { propertyId = Guid.NewGuid().ToString() },
            org.OwnerCookie);

        Assert.Equal(HttpStatusCode.NotFound, response.Status);
        Assert.Equal("PROP_001", response.ErrorCode);
    }

    [Fact]
    public async Task Removing_a_charter_that_still_governs_devices_is_409_PROP_008()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerCookie);
        await InventoryScaffold.CreateDeviceAsync(_api, org.OwnerCookie, site.NetworkId, site.SiteId);

        var refused = await _api.DeleteAsync(
            $"v1/networks/{site.NetworkId}/properties/{site.SiteId}",
            org.OwnerCookie);

        Assert.Equal(HttpStatusCode.Conflict, refused.Status);
        Assert.Equal("PROP_008", refused.ErrorCode);
    }

    [Fact]
    public async Task Removing_a_device_free_charter_succeeds_and_a_second_remove_is_404_PROP_001()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerCookie);

        var remove = await _api.DeleteAsync(
            $"v1/networks/{site.NetworkId}/properties/{site.SiteId}",
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, remove.Status);
        Assert.Equal(JsonValueKind.Null, remove.Data.ValueKind);

        var again = await _api.DeleteAsync(
            $"v1/networks/{site.NetworkId}/properties/{site.SiteId}",
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.NotFound, again.Status);
        Assert.Equal("PROP_001", again.ErrorCode);
    }
}
