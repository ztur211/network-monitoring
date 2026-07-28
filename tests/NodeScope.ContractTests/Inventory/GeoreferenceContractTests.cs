using NodeScope.ContractTests.Monitoring;

namespace NodeScope.ContractTests.Inventory;

/// <summary>
/// Contract for the building-model georeference (PUT v1/buildings/:id/model/georeference)
/// and the derived map pins it creates: while a device is placed (x/y/z) in a georeferenced
/// model, its latitude/longitude are a projection of that placement - the georeference write
/// re-derives every placed device, a position write derives in the same call, clearing a
/// derived position clears the pin, and direct latitude/longitude edits are refused with
/// SPATIAL_003. Without a georeference nothing changes: pins stay manual.
/// </summary>
[Collection(ContractSuite.Name)]
public class GeoreferenceContractTests
{
    private const double AnchorLatitude = 49.1;
    private const double AnchorLongitude = 8.44;

    private static readonly object CompleteGeoreference = new
    {
        anchorLatitude = AnchorLatitude,
        anchorLongitude = AnchorLongitude,
        anchorX = 0.0,
        anchorY = 0.0,
        rotationDegrees = 0.0,
        metersPerUnit = 1.0,
    };

    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public GeoreferenceContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Georeference_set_round_trips_and_rederives_placed_devices()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var monitored = await MonitoringScaffold.MonitoredDeviceAsync(_api, org.OwnerAuth);
        await InventoryScaffold.UploadModelVersionAsync(_api, org.OwnerAuth, monitored.BuildingId);

        // Placed before any georeference exists: x/y/z land, the pin stays empty.
        var placed = await _api.PatchAsync(
            $"v1/devices/{monitored.DeviceId}/position",
            new { x = 100.0, y = 200.0, z = 1.0 },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, placed.Status);
        Assert.Equal(JsonValueKind.Null, placed.Data.GetProperty("latitude").ValueKind);
        var versionBefore = placed.Data.GetProperty("version").GetInt32();

        var set = await _api.PutAsync(
            $"v1/buildings/{monitored.BuildingId}/model/georeference",
            CompleteGeoreference,
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, set.Status);
        var georeference = set.Data.GetProperty("georeference");
        Assert.Equal(AnchorLatitude, georeference.GetProperty("anchorLatitude").GetDouble());
        Assert.Equal(AnchorLongitude, georeference.GetProperty("anchorLongitude").GetDouble());

        var model = await _api.GetAsync($"v1/buildings/{monitored.BuildingId}/model", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, model.Status);
        Assert.Equal(
            1.0, model.Data.GetProperty("georeference").GetProperty("metersPerUnit").GetDouble());

        // The placed device's pin is now a projection of (100, 200): 200 m north of the
        // anchor is ~0.0018° latitude, 100 m east is ~0.0014° longitude at 49.1°N.
        var device = await _api.GetAsync($"v1/devices/{monitored.DeviceId}", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, device.Status);
        Assert.InRange(device.Data.GetProperty("latitude").GetDouble(), 49.1017, 49.1019);
        Assert.InRange(device.Data.GetProperty("longitude").GetDouble(), 8.4413, 8.4415);
        Assert.Equal(versionBefore + 1, device.Data.GetProperty("version").GetInt32());
    }

    [Fact]
    public async Task Position_writes_in_a_georeferenced_model_carry_the_pin_with_them()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var monitored = await MonitoringScaffold.MonitoredDeviceAsync(_api, org.OwnerAuth);
        await InventoryScaffold.UploadModelVersionAsync(_api, org.OwnerAuth, monitored.BuildingId);
        var set = await _api.PutAsync(
            $"v1/buildings/{monitored.BuildingId}/model/georeference",
            CompleteGeoreference,
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, set.Status);

        // Placing at the anchor point projects exactly onto the anchor coordinates.
        var placed = await _api.PatchAsync(
            $"v1/devices/{monitored.DeviceId}/position",
            new { x = 0.0, y = 0.0, z = 0.0 },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, placed.Status);
        Assert.Equal(AnchorLatitude, placed.Data.GetProperty("latitude").GetDouble());
        Assert.Equal(AnchorLongitude, placed.Data.GetProperty("longitude").GetDouble());

        // Clearing a derived position takes the pin with it.
        var cleared = await _api.PatchAsync(
            $"v1/devices/{monitored.DeviceId}/position",
            new { x = (double?)null, y = (double?)null, z = (double?)null },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, cleared.Status);
        Assert.Equal(JsonValueKind.Null, cleared.Data.GetProperty("x").ValueKind);
        Assert.Equal(JsonValueKind.Null, cleared.Data.GetProperty("latitude").ValueKind);
        Assert.Equal(JsonValueKind.Null, cleared.Data.GetProperty("longitude").ValueKind);
    }

    [Fact]
    public async Task Without_a_georeference_position_writes_leave_manual_pins_alone()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var monitored = await MonitoringScaffold.MonitoredDeviceAsync(_api, org.OwnerAuth);
        await InventoryScaffold.UploadModelVersionAsync(_api, org.OwnerAuth, monitored.BuildingId);

        var device = await _api.GetAsync($"v1/devices/{monitored.DeviceId}", org.OwnerAuth);
        var pin = await _api.PatchAsync(
            $"v1/devices/{monitored.DeviceId}",
            new
            {
                baseVersion = device.Data.GetProperty("version").GetInt32(),
                changes = new[]
                {
                    new { field = "latitude", oldValue = (object?)null, newValue = (object?)50.5 },
                    new { field = "longitude", oldValue = (object?)null, newValue = (object?)7.25 },
                },
            },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, pin.Status);

        var placed = await _api.PatchAsync(
            $"v1/devices/{monitored.DeviceId}/position",
            new { x = 5.0, y = 6.0, z = 0.0 },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, placed.Status);
        Assert.Equal(50.5, placed.Data.GetProperty("latitude").GetDouble());

        var cleared = await _api.PatchAsync(
            $"v1/devices/{monitored.DeviceId}/position",
            new { x = (double?)null, y = (double?)null, z = (double?)null },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, cleared.Status);
        Assert.Equal(50.5, cleared.Data.GetProperty("latitude").GetDouble());
        Assert.Equal(7.25, cleared.Data.GetProperty("longitude").GetDouble());
    }

    [Fact]
    public async Task Manual_pin_writes_on_a_derived_pin_are_422_SPATIAL_003()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var monitored = await MonitoringScaffold.MonitoredDeviceAsync(_api, org.OwnerAuth);
        await InventoryScaffold.UploadModelVersionAsync(_api, org.OwnerAuth, monitored.BuildingId);
        await _api.PutAsync(
            $"v1/buildings/{monitored.BuildingId}/model/georeference",
            CompleteGeoreference,
            org.OwnerAuth);
        var placed = await _api.PatchAsync(
            $"v1/devices/{monitored.DeviceId}/position",
            new { x = 1.0, y = 1.0, z = 0.0 },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, placed.Status);

        var refused = await _api.PatchAsync(
            $"v1/devices/{monitored.DeviceId}",
            new
            {
                baseVersion = placed.Data.GetProperty("version").GetInt32(),
                changes = new[]
                {
                    new { field = "latitude", oldValue = (object?)null, newValue = (object?)12.0 },
                },
            },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, refused.Status);
        Assert.Equal("SPATIAL_003", refused.ErrorCode);

        // Clearing the placement releases the pin back to manual control.
        var cleared = await _api.PatchAsync(
            $"v1/devices/{monitored.DeviceId}/position",
            new { x = (double?)null, y = (double?)null, z = (double?)null },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, cleared.Status);
        var manual = await _api.PatchAsync(
            $"v1/devices/{monitored.DeviceId}",
            new
            {
                baseVersion = cleared.Data.GetProperty("version").GetInt32(),
                changes = new[]
                {
                    new { field = "latitude", oldValue = (object?)null, newValue = (object?)12.0 },
                },
            },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, manual.Status);
        Assert.Equal(12.0, manual.Data.GetProperty("latitude").GetDouble());
    }

    [Fact]
    public async Task Georeference_validation_rejects_partial_and_out_of_range_bodies()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var monitored = await MonitoringScaffold.MonitoredDeviceAsync(_api, org.OwnerAuth);
        await InventoryScaffold.UploadModelVersionAsync(_api, org.OwnerAuth, monitored.BuildingId);

        var partial = await _api.PutAsync(
            $"v1/buildings/{monitored.BuildingId}/model/georeference",
            new { anchorLatitude = 49.1 },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.BadRequest, partial.Status);
        Assert.Equal("GEN_001", partial.ErrorCode);

        var outOfRange = await _api.PutAsync(
            $"v1/buildings/{monitored.BuildingId}/model/georeference",
            new
            {
                anchorLatitude = 91.0,
                anchorLongitude = 8.44,
                anchorX = 0.0,
                anchorY = 0.0,
                rotationDegrees = 0.0,
                metersPerUnit = 0.0,
            },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.BadRequest, outOfRange.Status);
        Assert.Equal("GEN_001", outOfRange.ErrorCode);
    }

    [Fact]
    public async Task Georeference_on_an_unmodeled_building_is_404_MODEL_001()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerAuth);
        var building = await InventoryScaffold.CreatePropertyAsync(
            _api, org.OwnerAuth, "BUILDING", parentId: InventoryScaffold.RequireId(site));

        var response = await _api.PutAsync(
            $"v1/buildings/{InventoryScaffold.RequireId(building)}/model/georeference",
            CompleteGeoreference,
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, response.Status);
        Assert.Equal("MODEL_001", response.ErrorCode);
    }

    [Fact]
    public async Task Clearing_the_georeference_keeps_the_last_derived_pins()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var monitored = await MonitoringScaffold.MonitoredDeviceAsync(_api, org.OwnerAuth);
        await InventoryScaffold.UploadModelVersionAsync(_api, org.OwnerAuth, monitored.BuildingId);
        await _api.PutAsync(
            $"v1/buildings/{monitored.BuildingId}/model/georeference",
            CompleteGeoreference,
            org.OwnerAuth);
        var placed = await _api.PatchAsync(
            $"v1/devices/{monitored.DeviceId}/position",
            new { x = 0.0, y = 0.0, z = 0.0 },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, placed.Status);

        var cleared = await _api.PutAsync(
            $"v1/buildings/{monitored.BuildingId}/model/georeference",
            new { },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, cleared.Status);
        Assert.Equal(JsonValueKind.Null, cleared.Data.GetProperty("georeference").ValueKind);

        // The last projection was accurate when made; clearing the georeference does not
        // erase it, it only stops future derivation.
        var device = await _api.GetAsync($"v1/devices/{monitored.DeviceId}", org.OwnerAuth);
        Assert.Equal(AnchorLatitude, device.Data.GetProperty("latitude").GetDouble());
        Assert.Equal(AnchorLongitude, device.Data.GetProperty("longitude").GetDouble());
    }
}
