using NodeScope.ContractTests.Inventory;

namespace NodeScope.ContractTests.Realtime;

/// <summary>
/// Contract for the building-model version events, walked as one lifecycle because the
/// arrange steps chain: uploading emits versionUploaded (and silently auto-activates,
/// with no activated event - only the explicit PUT emits one), re-activating an older
/// version emits activated, and deleting a non-active version emits deleted. All three
/// fan out to the whole org room, and - like the team/assignment family - they are
/// pushed straight through the gateway, so the payloads carry no timestamp.
/// </summary>
[Collection(ContractSuite.Name)]
public class BuildingModelRealtimeTests
{
    private static readonly TimeSpan NegativeWindow = TimeSpan.FromSeconds(2);

    /// <summary>The smallest body the upload accepts: the IFC-SPF magic prefix is the
    /// only content validation.</summary>
    private static readonly byte[] TinyIfc =
        System.Text.Encoding.UTF8.GetBytes("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");

    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public BuildingModelRealtimeTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Org_room_hears_the_model_version_lifecycle_uploaded_activated_deleted()
    {
        var (org, buildingId) = await OrgWithBuildingAsync();
        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerAuth);

        // Upload v1: versionUploaded fires with the version's number and id.
        var v1 = await UploadVersionAsync(buildingId, org.OwnerAuth);
        var uploaded = await socket.WaitForEventAsync(
            "v1:buildingModel:versionUploaded",
            p => VersionIdIs(p, v1));
        Assert.Equal(buildingId, uploaded.GetProperty("propertyId").GetString());
        Assert.Equal(1, uploaded.GetProperty("versionNumber").GetInt32());
        Assert.False(uploaded.TryGetProperty("timestamp", out _));

        // Upload v2. It auto-activates - but only the explicit PUT emits activated, so
        // the upload path must stay activation-silent.
        var v2 = await UploadVersionAsync(buildingId, org.OwnerAuth);
        await socket.WaitForEventAsync("v1:buildingModel:versionUploaded", p => VersionIdIs(p, v2));
        await Assert.ThrowsAsync<TimeoutException>(
            () => socket.WaitForEventAsync("v1:buildingModel:activated", timeout: NegativeWindow));

        // Explicitly re-activate v1: activated fires with the property/version pair.
        var activate = await _api.PutAsync(
            $"v1/buildings/{buildingId}/model/active",
            new { versionId = v1 },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, activate.Status);
        var activated = await socket.WaitForEventAsync("v1:buildingModel:activated", p => VersionIdIs(p, v1));
        Assert.Equal(buildingId, activated.GetProperty("propertyId").GetString());

        // Delete v2 (no longer active - deleting the active version is refused): deleted
        // fires carrying only the version id.
        var delete = await _api.DeleteAsync($"v1/buildings/{buildingId}/model/versions/{v2}", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NoContent, delete.Status);
        var deleted = await socket.WaitForEventAsync("v1:buildingModel:deleted", p => VersionIdIs(p, v2));
        Assert.False(deleted.TryGetProperty("propertyId", out _));
    }

    /// <summary>A SITE with a BUILDING under it - the only property type a model accepts.</summary>
    private async Task<(ProvisionedOrg Org, string BuildingId)> OrgWithBuildingAsync()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerAuth);
        var building = await InventoryScaffold.CreatePropertyAsync(
            _api, org.OwnerAuth, "BUILDING", parentId: InventoryScaffold.RequireId(site));
        return (org, InventoryScaffold.RequireId(building));
    }

    private async Task<string> UploadVersionAsync(string buildingId, Auth auth)
    {
        var upload = await _api.PostRawAsync(
            $"v1/buildings/{buildingId}/model/versions?fileName=model.ifc",
            TinyIfc,
            auth: auth);
        Assert.Equal(HttpStatusCode.Created, upload.Status);
        return InventoryScaffold.RequireId(upload.Data);
    }

    private static bool VersionIdIs(JsonElement payload, string versionId) =>
        payload.TryGetProperty("versionId", out var v) && v.GetString() == versionId;
}
