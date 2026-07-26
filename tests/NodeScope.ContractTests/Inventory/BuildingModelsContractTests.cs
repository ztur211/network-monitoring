namespace NodeScope.ContractTests.Inventory;

/// <summary>
/// Contract for the building-model read/download side - the realtime suite already
/// drove the upload/activate/delete lifecycle events. A building without a model is
/// MODEL_001 on every read; upload refuses non-BUILDING properties (MODEL_002, 422)
/// and non-IFC bytes (MODEL_007, 422). After an upload the model read shows the
/// auto-activated version, the versions list grows monotonically, and the file
/// downloads (active and by-version) return the exact uploaded bytes as a raw
/// octet-stream. Unknown versions are MODEL_004; deleting the active version is
/// refused with MODEL_005 (409). The native-client path can keep a version inactive,
/// pair it with validated wexBIM and IFC element-index artifacts, and activate only
/// after all derived objects land.
/// </summary>
[Collection(ContractSuite.Name)]
public class BuildingModelsContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public BuildingModelsContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task A_modelless_building_is_404_MODEL_001_on_every_read()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var building = await InventoryScaffold.CreateBuildingAsync(_api, org.OwnerAuth);

        var model = await _api.GetAsync($"v1/buildings/{building.BuildingId}/model", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, model.Status);
        Assert.Equal("MODEL_001", model.ErrorCode);

        var versions = await _api.GetAsync($"v1/buildings/{building.BuildingId}/model/versions", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, versions.Status);
        Assert.Equal("MODEL_001", versions.ErrorCode);

        var file = await _api.GetRawAsync($"v1/buildings/{building.BuildingId}/model/active/file", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, file.Status);
    }

    [Fact]
    public async Task Upload_refuses_non_buildings_MODEL_002_and_non_ifc_bytes_MODEL_007()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var building = await InventoryScaffold.CreateBuildingAsync(_api, org.OwnerAuth);

        var ontoSite = await _api.PostRawAsync(
            $"v1/buildings/{building.SiteId}/model/versions?fileName=model.ifc",
            InventoryScaffold.MinimalIfcBytes(),
            auth: org.OwnerAuth);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, ontoSite.Status);
        Assert.Equal("MODEL_002", ontoSite.ErrorCode);

        var notIfc = await _api.PostRawAsync(
            $"v1/buildings/{building.BuildingId}/model/versions?fileName=model.ifc",
            System.Text.Encoding.UTF8.GetBytes("definitely not a STEP file"),
            auth: org.OwnerAuth);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, notIfc.Status);
        Assert.Equal("MODEL_007", notIfc.ErrorCode);
    }

    [Fact]
    public async Task Upload_activates_and_the_file_downloads_round_trip_the_bytes()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var building = await InventoryScaffold.CreateBuildingAsync(_api, org.OwnerAuth);
        var bytes = InventoryScaffold.MinimalIfcBytes();

        var version = await InventoryScaffold.UploadModelVersionAsync(
            _api, org.OwnerAuth, building.BuildingId, fileName: "hq.ifc", bytes: bytes);
        var versionId = InventoryScaffold.RequireId(version);
        Assert.Equal(1, version.GetProperty("versionNumber").GetInt32());

        var model = await _api.GetAsync($"v1/buildings/{building.BuildingId}/model", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, model.Status);
        Assert.Equal(versionId, model.Data.GetProperty("activeVersionId").GetString());

        var versions = await _api.GetAsync($"v1/buildings/{building.BuildingId}/model/versions", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, versions.Status);
        Assert.Contains(
            versions.Data.EnumerateArray(),
            v => v.GetProperty("id").GetString() == versionId);

        var active = await _api.GetRawAsync(
            $"v1/buildings/{building.BuildingId}/model/active/file",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, active.Status);
        Assert.Contains("application/octet-stream", active.Header("Content-Type"), StringComparison.Ordinal);
        Assert.Contains("hq.ifc", active.Header("Content-Disposition"), StringComparison.Ordinal);
        Assert.Equal(bytes, active.Body);

        var byVersion = await _api.GetRawAsync(
            $"v1/buildings/{building.BuildingId}/model/versions/{versionId}/file",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, byVersion.Status);
        Assert.Equal(bytes, byVersion.Body);
    }

    [Fact]
    public async Task Native_import_pairs_ifc_and_wexbim_before_activation()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var building = await InventoryScaffold.CreateBuildingAsync(_api, org.OwnerAuth);
        var ifc = InventoryScaffold.MinimalIfcBytes();
        var geometry = InventoryScaffold.CubeWexBimBytes();

        var upload = await _api.PostRawAsync(
            $"v1/buildings/{building.BuildingId}/model/versions?fileName=cube.ifc&activate=false",
            ifc,
            auth: org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, upload.Status);
        var versionId = InventoryScaffold.RequireId(upload.Data);

        var modelBeforeActivation = await _api.GetAsync(
            $"v1/buildings/{building.BuildingId}/model",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, modelBeforeActivation.Status);
        Assert.Equal(JsonValueKind.Null, modelBeforeActivation.Data.GetProperty("activeVersionId").ValueKind);

        var missing = await _api.GetAsync(
            $"v1/buildings/{building.BuildingId}/model/versions/{versionId}/geometry",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, missing.Status);
        Assert.Equal("MODEL_009", missing.ErrorCode);

        var invalid = await _api.PutRawAsync(
            $"v1/buildings/{building.BuildingId}/model/versions/{versionId}/geometry",
            [1, 2, 3, 4, 5],
            auth: org.OwnerAuth);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, invalid.Status);
        Assert.Equal("MODEL_010", invalid.ErrorCode);

        var geometryUpload = await _api.PutRawAsync(
            $"v1/buildings/{building.BuildingId}/model/versions/{versionId}/geometry",
            geometry,
            "application/vnd.xbim.wexbim",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, geometryUpload.Status);
        Assert.Equal(versionId, geometryUpload.Data.GetProperty("versionId").GetString());
        Assert.Equal("WEXBIM", geometryUpload.Data.GetProperty("format").GetString());
        Assert.Equal(geometry.Length, geometryUpload.Data.GetProperty("sizeBytes").GetInt32());
        Assert.Equal(
            Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(geometry)),
            geometryUpload.Data.GetProperty("contentHash").GetString());

        var byVersion = await _api.GetRawAsync(
            $"v1/buildings/{building.BuildingId}/model/versions/{versionId}/geometry",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, byVersion.Status);
        Assert.Contains("application/vnd.xbim.wexbim", byVersion.Header("Content-Type"), StringComparison.Ordinal);
        Assert.Contains("cube.wexbim", byVersion.Header("Content-Disposition"), StringComparison.Ordinal);
        Assert.Equal(geometry, byVersion.Body);

        var missingMetadata = await _api.GetAsync(
            $"v1/buildings/{building.BuildingId}/model/versions/{versionId}/metadata",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, missingMetadata.Status);
        Assert.Equal("MODEL_012", missingMetadata.ErrorCode);

        var metadataUpload = await _api.PutAsync(
            $"v1/buildings/{building.BuildingId}/model/versions/{versionId}/metadata",
            new
            {
                formatVersion = 1,
                elements = new[]
                {
                    new
                    {
                        productLabel = 17,
                        globalId = "0ABCDEFGHIJKLMNOPQRSTU",
                        typeName = "IfcWall",
                        name = "North service wall",
                    },
                },
            },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, metadataUpload.Status);
        Assert.Equal(versionId, metadataUpload.Data.GetProperty("versionId").GetString());
        Assert.Equal(1, metadataUpload.Data.GetProperty("formatVersion").GetInt32());
        Assert.Equal(1, metadataUpload.Data.GetProperty("elementCount").GetInt32());
        Assert.True(metadataUpload.Data.GetProperty("sizeBytes").GetInt32() > 0);
        Assert.Equal(64, metadataUpload.Data.GetProperty("contentHash").GetString()?.Length);

        var versionMetadata = await _api.GetAsync(
            $"v1/buildings/{building.BuildingId}/model/versions/{versionId}/metadata",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, versionMetadata.Status);
        Assert.Equal(versionId, versionMetadata.Data.GetProperty("versionId").GetString());
        var element = Assert.Single(versionMetadata.Data.GetProperty("elements").EnumerateArray());
        Assert.Equal(17, element.GetProperty("productLabel").GetInt32());
        Assert.Equal("0ABCDEFGHIJKLMNOPQRSTU", element.GetProperty("globalId").GetString());
        Assert.Equal("IfcWall", element.GetProperty("typeName").GetString());
        Assert.Equal("North service wall", element.GetProperty("name").GetString());

        var activation = await _api.PutAsync(
            $"v1/buildings/{building.BuildingId}/model/active",
            new { versionId },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, activation.Status);

        var active = await _api.GetRawAsync(
            $"v1/buildings/{building.BuildingId}/model/active/geometry",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, active.Status);
        Assert.Equal(geometry, active.Body);

        var activeMetadata = await _api.GetAsync(
            $"v1/buildings/{building.BuildingId}/model/active/metadata",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, activeMetadata.Status);
        Assert.Equal(versionId, activeMetadata.Data.GetProperty("versionId").GetString());
    }

    [Fact]
    public async Task Unknown_versions_are_404_MODEL_004_and_the_active_one_cannot_be_deleted_MODEL_005()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var building = await InventoryScaffold.CreateBuildingAsync(_api, org.OwnerAuth);
        var version = await InventoryScaffold.UploadModelVersionAsync(_api, org.OwnerAuth, building.BuildingId);
        var versionId = InventoryScaffold.RequireId(version);

        var activateUnknown = await _api.PutAsync(
            $"v1/buildings/{building.BuildingId}/model/active",
            new { versionId = Guid.NewGuid().ToString() },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, activateUnknown.Status);
        Assert.Equal("MODEL_004", activateUnknown.ErrorCode);

        var downloadUnknown = await _api.GetRawAsync(
            $"v1/buildings/{building.BuildingId}/model/versions/{Guid.NewGuid()}/file",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, downloadUnknown.Status);

        var deleteActive = await _api.DeleteAsync(
            $"v1/buildings/{building.BuildingId}/model/versions/{versionId}",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Conflict, deleteActive.Status);
        Assert.Equal("MODEL_005", deleteActive.ErrorCode);
    }

    [Fact]
    public async Task A_second_upload_becomes_active_and_frees_the_first_for_deletion()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var building = await InventoryScaffold.CreateBuildingAsync(_api, org.OwnerAuth);
        var first = await InventoryScaffold.UploadModelVersionAsync(_api, org.OwnerAuth, building.BuildingId);
        var firstId = InventoryScaffold.RequireId(first);
        var second = await InventoryScaffold.UploadModelVersionAsync(_api, org.OwnerAuth, building.BuildingId);
        var secondId = InventoryScaffold.RequireId(second);
        Assert.Equal(2, second.GetProperty("versionNumber").GetInt32());

        var model = await _api.GetAsync($"v1/buildings/{building.BuildingId}/model", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, model.Status);
        Assert.Equal(secondId, model.Data.GetProperty("activeVersionId").GetString());

        var deleteFirst = await _api.DeleteAsync(
            $"v1/buildings/{building.BuildingId}/model/versions/{firstId}",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NoContent, deleteFirst.Status);

        var versions = await _api.GetAsync($"v1/buildings/{building.BuildingId}/model/versions", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, versions.Status);
        Assert.DoesNotContain(
            versions.Data.EnumerateArray(),
            v => v.GetProperty("id").GetString() == firstId);
    }
}
