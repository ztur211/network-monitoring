using NodeScope.ContractTests.Monitoring;

namespace NodeScope.ContractTests.Inventory;

/// <summary>
/// Contract for device 3D placement (PATCH v1/devices/:id/position and /ifc-link).
/// Placement only means something inside a modeled building, so setting either a
/// position or a link requires the device's governing building to hold an active
/// model (SPATIAL_001, 422) - while CLEARING either never does. A position is a
/// complete triple or nothing: a partial x/y/z is SPATIAL_002 (422). The unknown
/// device is the usual DEVICE_001.
/// </summary>
[Collection(ContractSuite.Name)]
public class SpatialContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public SpatialContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Position_set_requires_a_modeled_building_then_round_trips()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var monitored = await MonitoringScaffold.MonitoredDeviceAsync(_api, org.OwnerAuth);

        // No model on the building yet - a real position is refused.
        var unmodeled = await _api.PatchAsync(
            $"v1/devices/{monitored.DeviceId}/position",
            new { x = 1.5, y = 2.5, z = 0.5 },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, unmodeled.Status);
        Assert.Equal("SPATIAL_001", unmodeled.ErrorCode);

        await InventoryScaffold.UploadModelVersionAsync(_api, org.OwnerAuth, monitored.BuildingId);

        var set = await _api.PatchAsync(
            $"v1/devices/{monitored.DeviceId}/position",
            new { x = 1.5, y = 2.5, z = 0.5 },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, set.Status);
        Assert.Equal(1.5, set.Data.GetProperty("x").GetDouble());
        Assert.Equal(2.5, set.Data.GetProperty("y").GetDouble());
        Assert.Equal(0.5, set.Data.GetProperty("z").GetDouble());

        // Clearing takes EXPLICIT nulls (absent fields are left untouched) and
        // works regardless of the model.
        var clear = await _api.PatchAsync(
            $"v1/devices/{monitored.DeviceId}/position",
            new { x = (double?)null, y = (double?)null, z = (double?)null },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, clear.Status);
        Assert.Equal(JsonValueKind.Null, clear.Data.GetProperty("x").ValueKind);
        Assert.Equal(JsonValueKind.Null, clear.Data.GetProperty("y").ValueKind);
        Assert.Equal(JsonValueKind.Null, clear.Data.GetProperty("z").ValueKind);
    }

    [Fact]
    public async Task A_partial_position_triple_is_422_SPATIAL_002()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var monitored = await MonitoringScaffold.MonitoredDeviceAsync(_api, org.OwnerAuth);
        await InventoryScaffold.UploadModelVersionAsync(_api, org.OwnerAuth, monitored.BuildingId);

        var response = await _api.PatchAsync(
            $"v1/devices/{monitored.DeviceId}/position",
            new { x = 1.0 },
            org.OwnerAuth);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.Status);
        Assert.Equal("SPATIAL_002", response.ErrorCode);
    }

    [Fact]
    public async Task IfcLink_set_requires_a_modeled_building_and_clearing_never_does()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var monitored = await MonitoringScaffold.MonitoredDeviceAsync(_api, org.OwnerAuth);

        var unmodeled = await _api.PatchAsync(
            $"v1/devices/{monitored.DeviceId}/ifc-link",
            new { ifcGlobalId = "2O2Fr$t4X7Zf8NOew3FLKI" },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, unmodeled.Status);
        Assert.Equal("SPATIAL_001", unmodeled.ErrorCode);

        await InventoryScaffold.UploadModelVersionAsync(_api, org.OwnerAuth, monitored.BuildingId);

        var set = await _api.PatchAsync(
            $"v1/devices/{monitored.DeviceId}/ifc-link",
            new { ifcGlobalId = "2O2Fr$t4X7Zf8NOew3FLKI" },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, set.Status);
        Assert.Equal("2O2Fr$t4X7Zf8NOew3FLKI", set.Data.GetProperty("ifcGlobalId").GetString());

        var clear = await _api.PatchAsync(
            $"v1/devices/{monitored.DeviceId}/ifc-link",
            new { ifcGlobalId = (string?)null },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, clear.Status);
        Assert.Equal(JsonValueKind.Null, clear.Data.GetProperty("ifcGlobalId").ValueKind);
    }

    [Fact]
    public async Task Unknown_device_is_404_DEVICE_001()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var position = await _api.PatchAsync(
            $"v1/devices/{Guid.NewGuid()}/position",
            new { },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, position.Status);
        Assert.Equal("DEVICE_001", position.ErrorCode);

        var link = await _api.PatchAsync(
            $"v1/devices/{Guid.NewGuid()}/ifc-link",
            new { ifcGlobalId = (string?)null },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, link.Status);
        Assert.Equal("DEVICE_001", link.ErrorCode);
    }
}
