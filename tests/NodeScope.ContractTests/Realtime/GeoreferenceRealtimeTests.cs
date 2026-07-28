using NodeScope.ContractTests.Inventory;
using NodeScope.ContractTests.Monitoring;

namespace NodeScope.ContractTests.Realtime;

/// <summary>
/// Contract for the georeference write's realtime fan-out: the org room hears
/// v1:buildingModel:georeference (gateway-direct like the rest of the buildingModel family,
/// so no timestamp), and every re-derived device emits the ordinary v1:device:updated with
/// latitude/longitude in its changes - which is exactly what keeps an open map current.
/// </summary>
[Collection(ContractSuite.Name)]
public class GeoreferenceRealtimeTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public GeoreferenceRealtimeTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Georeference_set_emits_the_org_event_then_device_updates_for_rederived_pins()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var monitored = await MonitoringScaffold.MonitoredDeviceAsync(_api, org.OwnerAuth);
        await InventoryScaffold.UploadModelVersionAsync(_api, org.OwnerAuth, monitored.BuildingId);
        var placed = await _api.PatchAsync(
            $"v1/devices/{monitored.DeviceId}/position",
            new { x = 0.0, y = 0.0, z = 0.0 },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, placed.Status);

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerAuth);

        var set = await _api.PutAsync(
            $"v1/buildings/{monitored.BuildingId}/model/georeference",
            new
            {
                anchorLatitude = 49.1,
                anchorLongitude = 8.44,
                anchorX = 0.0,
                anchorY = 0.0,
                rotationDegrees = 0.0,
                metersPerUnit = 1.0,
            },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, set.Status);

        var georeference = await socket.WaitForEventAsync("v1:buildingModel:georeference");
        Assert.Equal(monitored.BuildingId, georeference.GetProperty("propertyId").GetString());
        Assert.Equal(
            49.1, georeference.GetProperty("georeference").GetProperty("anchorLatitude").GetDouble());
        Assert.False(georeference.TryGetProperty("timestamp", out _));

        var updated = await socket.WaitForEventAsync(
            "v1:device:updated",
            p => p.TryGetProperty("deviceId", out var id) && id.GetString() == monitored.DeviceId);
        Assert.Equal(
            49.1, updated.GetProperty("device").GetProperty("latitude").GetDouble());
        Assert.Contains(
            updated.GetProperty("changes").EnumerateArray(),
            change => change.GetProperty("field").GetString() == "latitude");
    }
}
