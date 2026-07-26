using NodeScope.ContractTests.Monitoring;

namespace NodeScope.ContractTests.Inventory;

/// <summary>
/// Contract for the IFC network export (GET v1/buildings/:propertyId/export/ifc).
/// The download is a raw STEP file - ISO-10303-21 header, application/x-step, an
/// attachment disposition named after the building - carrying the building's
/// PLACED devices (x/y/z set). Only BUILDING properties export: a SITE or an
/// unknown id is the same invisible PROP_001.
/// </summary>
[Collection(ContractSuite.Name)]
public class ExportContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public ExportContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Export_streams_a_step_file_for_a_building()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var monitored = await MonitoringScaffold.MonitoredDeviceAsync(_api, org.OwnerAuth);
        await InventoryScaffold.UploadModelVersionAsync(_api, org.OwnerAuth, monitored.BuildingId);
        var place = await _api.PatchAsync(
            $"v1/devices/{monitored.DeviceId}/position",
            new { x = 1.0, y = 2.0, z = 3.0 },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, place.Status);

        var export = await _api.GetRawAsync(
            $"v1/buildings/{monitored.BuildingId}/export/ifc",
            org.OwnerAuth);

        Assert.Equal(HttpStatusCode.OK, export.Status);
        Assert.Contains("application/x-step", export.Header("Content-Type"), StringComparison.Ordinal);
        Assert.Contains("-network.ifc", export.Header("Content-Disposition"), StringComparison.Ordinal);
        var text = System.Text.Encoding.UTF8.GetString([.. export.Body]);
        Assert.StartsWith("ISO-10303-21;", text, StringComparison.Ordinal);
        Assert.Contains("END-ISO-10303-21;", text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Only_buildings_export_a_site_or_unknown_id_is_404_PROP_001()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var building = await InventoryScaffold.CreateBuildingAsync(_api, org.OwnerAuth);

        var site = await _api.GetRawAsync(
            $"v1/buildings/{building.SiteId}/export/ifc",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, site.Status);

        var unknown = await _api.GetRawAsync(
            $"v1/buildings/{Guid.NewGuid()}/export/ifc",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, unknown.Status);
    }
}
