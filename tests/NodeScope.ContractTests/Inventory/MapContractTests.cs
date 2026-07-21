namespace NodeScope.ContractTests.Inventory;

/// <summary>
/// Contract for the map bbox reads (v1/map/{devices,fiber-runs,circuits}). All
/// three take a west,south,east,north bbox; a malformed or out-of-range one is
/// GEN_001. Geometry comes from device coordinates: a device is in the answer iff
/// its lat/lng falls inside the envelope, a fiber run iff EITHER endpoint device
/// does, a circuit iff its linked device does. The devices read also filters by
/// ?floor.
/// </summary>
[Collection(ContractSuite.Name)]
public class MapContractTests
{
    // A 1x1-degree box around the test coordinates, far from 0,0.
    private const string InsideBbox = "10.0,50.0,11.0,51.0";

    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public MapContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Malformed_or_out_of_range_bbox_is_400_GEN_001()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var malformed = await _api.GetAsync("v1/map/devices?bbox=not-a-bbox", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.BadRequest, malformed.Status);
        Assert.Equal("GEN_001", malformed.ErrorCode);

        var outOfRange = await _api.GetAsync("v1/map/devices?bbox=-190.0,0.0,10.0,1.0", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.BadRequest, outOfRange.Status);
        Assert.Equal("GEN_001", outOfRange.ErrorCode);
    }

    [Fact]
    public async Task Devices_read_returns_only_devices_inside_the_bbox_and_honors_floor()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerCookie);
        var insideId = await PlacedDeviceAsync(org, site, latitude: 50.5, longitude: 10.5, floor: 1);
        var outsideId = await PlacedDeviceAsync(org, site, latitude: 20.0, longitude: -30.0, floor: 1);
        var otherFloorId = await PlacedDeviceAsync(org, site, latitude: 50.6, longitude: 10.6, floor: 3);

        var read = await _api.GetAsync($"v1/map/devices?bbox={InsideBbox}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, read.Status);
        var ids = read.Data.GetProperty("items").EnumerateArray()
            .Select(d => d.GetProperty("id").GetString()).ToList();
        Assert.Contains(insideId, ids);
        Assert.Contains(otherFloorId, ids);
        Assert.DoesNotContain(outsideId, ids);

        var floored = await _api.GetAsync($"v1/map/devices?bbox={InsideBbox}&floor=3", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, floored.Status);
        var flooredIds = floored.Data.GetProperty("items").EnumerateArray()
            .Select(d => d.GetProperty("id").GetString()).ToList();
        Assert.Equal([otherFloorId], flooredIds);
    }

    [Fact]
    public async Task FiberRuns_read_includes_a_run_when_either_endpoint_is_inside()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerCookie);
        var insideId = await PlacedDeviceAsync(org, site, latitude: 50.5, longitude: 10.5);
        var outsideId = await PlacedDeviceAsync(org, site, latitude: 20.0, longitude: -30.0);
        var farAId = await PlacedDeviceAsync(org, site, latitude: -40.0, longitude: 100.0);
        var farBId = await PlacedDeviceAsync(org, site, latitude: -41.0, longitude: 101.0);

        // One endpoint inside is enough; both endpoints outside is not.
        var straddling = await CreateRunAsync(org, insideId, outsideId);
        var elsewhere = await CreateRunAsync(org, farAId, farBId);

        var read = await _api.GetAsync($"v1/map/fiber-runs?bbox={InsideBbox}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, read.Status);
        var ids = read.Data.GetProperty("items").EnumerateArray()
            .Select(r => r.GetProperty("id").GetString()).ToList();
        Assert.Contains(straddling, ids);
        Assert.DoesNotContain(elsewhere, ids);
    }

    [Fact]
    public async Task Circuits_read_follows_the_linked_device()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerCookie);
        var insideId = await PlacedDeviceAsync(org, site, latitude: 50.5, longitude: 10.5);
        var outsideId = await PlacedDeviceAsync(org, site, latitude: 20.0, longitude: -30.0);

        var insideCircuit = await CreateCircuitAsync(org, insideId);
        var outsideCircuit = await CreateCircuitAsync(org, outsideId);

        var read = await _api.GetAsync($"v1/map/circuits?bbox={InsideBbox}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, read.Status);
        var ids = read.Data.GetProperty("items").EnumerateArray()
            .Select(c => c.GetProperty("id").GetString()).ToList();
        Assert.Contains(insideCircuit, ids);
        Assert.DoesNotContain(outsideCircuit, ids);
    }

    private async Task<string> PlacedDeviceAsync(
        ProvisionedOrg org,
        InventoryScaffold.CharteredSite site,
        double latitude,
        double longitude,
        int? floor = null)
    {
        object body = floor is null
            ? new
            {
                name = $"map-dev-{Guid.NewGuid():N}",
                category = "SWITCH",
                networkId = site.NetworkId,
                propertyId = site.SiteId,
                latitude,
                longitude,
            }
            : new
            {
                name = $"map-dev-{Guid.NewGuid():N}",
                category = "SWITCH",
                networkId = site.NetworkId,
                propertyId = site.SiteId,
                latitude,
                longitude,
                floor,
            };
        var response = await _api.PostAsync("v1/devices", body, org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Created, response.Status);
        return InventoryScaffold.RequireId(response.Data);
    }

    private async Task<string> CreateRunAsync(ProvisionedOrg org, string startDeviceId, string endDeviceId)
    {
        var response = await _api.PostAsync(
            "v1/fiber-runs",
            new { name = $"map-run-{Guid.NewGuid():N}", startDeviceId, endDeviceId },
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Created, response.Status);
        return InventoryScaffold.RequireId(response.Data);
    }

    private async Task<string> CreateCircuitAsync(ProvisionedOrg org, string deviceId)
    {
        var response = await _api.PostAsync(
            "v1/circuits",
            new { ispName = $"isp-{Guid.NewGuid():N}", serviceType = "DIA", deviceId },
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Created, response.Status);
        return InventoryScaffold.RequireId(response.Data);
    }
}
