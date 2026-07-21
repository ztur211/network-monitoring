namespace NodeScope.ContractTests.Inventory;

/// <summary>
/// Contract for the BCF read/patch/import/export surface - the realtime side
/// already drove topic/comment creation events. The list returns a building's
/// topics and the detail carries comments; unknown topics are BCF_004 and a stale
/// patch baseVersion BCF_005; an unknown building is PROP_001 everywhere. Export
/// streams a raw .bcfzip (a real ZIP, no JSON envelope), and import is multipart:
/// a garbage archive is BCF_003, while re-importing the org's own export round-trips
/// the topics into another building - proving the two speak the same format.
/// </summary>
[Collection(ContractSuite.Name)]
public class BcfContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public BcfContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Topics_list_and_detail_return_what_was_created()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var building = await InventoryScaffold.CreateBuildingAsync(_api, org.OwnerCookie);
        var topicId = await CreateTopicAsync(org, building.BuildingId, "Leaky conduit");

        var comment = await _api.PostAsync(
            $"v1/bcf/topics/{topicId}/comments",
            new { comment = "Confirmed on site" },
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Created, comment.Status);

        var list = await _api.GetAsync($"v1/buildings/{building.BuildingId}/bcf/topics", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, list.Status);
        var summary = list.Data.EnumerateArray().Single(t => t.GetProperty("id").GetString() == topicId);
        Assert.Equal("Leaky conduit", summary.GetProperty("title").GetString());

        var detail = await _api.GetAsync($"v1/bcf/topics/{topicId}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, detail.Status);
        Assert.Equal("Leaky conduit", detail.Data.GetProperty("title").GetString());
        var comments = detail.Data.GetProperty("comments").EnumerateArray().ToList();
        Assert.Contains(comments, c => c.GetProperty("comment").GetString() == "Confirmed on site");
    }

    [Fact]
    public async Task Unknown_topic_is_404_BCF_004_and_unknown_building_PROP_001()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var topic = await _api.GetAsync($"v1/bcf/topics/{Guid.NewGuid()}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.NotFound, topic.Status);
        Assert.Equal("BCF_004", topic.ErrorCode);

        var topics = await _api.GetAsync($"v1/buildings/{Guid.NewGuid()}/bcf/topics", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.NotFound, topics.Status);
        Assert.Equal("PROP_001", topics.ErrorCode);

        var export = await _api.GetRawAsync($"v1/buildings/{Guid.NewGuid()}/bcf/export", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.NotFound, export.Status);
    }

    [Fact]
    public async Task Patch_with_a_stale_baseVersion_is_409_BCF_005()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var building = await InventoryScaffold.CreateBuildingAsync(_api, org.OwnerCookie);
        var topicId = await CreateTopicAsync(org, building.BuildingId, "Versioned");

        var first = await _api.PatchAsync(
            $"v1/bcf/topics/{topicId}",
            new { baseVersion = 1, title = "Renamed once" },
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, first.Status);

        var stale = await _api.PatchAsync(
            $"v1/bcf/topics/{topicId}",
            new { baseVersion = 1, title = "Stale write" },
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Conflict, stale.Status);
        Assert.Equal("BCF_005", stale.ErrorCode);
    }

    [Fact]
    public async Task Export_streams_a_real_zip_and_reimporting_it_round_trips_the_topics()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var source = await InventoryScaffold.CreateBuildingAsync(_api, org.OwnerCookie);
        await CreateTopicAsync(org, source.BuildingId, "Round-trip me");

        var export = await _api.GetRawAsync(
            $"v1/buildings/{source.BuildingId}/bcf/export",
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, export.Status);
        Assert.Contains("application/octet-stream", export.Header("Content-Type"), StringComparison.Ordinal);
        Assert.Contains(".bcfzip", export.Header("Content-Disposition"), StringComparison.Ordinal);
        // ZIP local-file-header magic: PK\x03\x04.
        Assert.True(export.Body.Count > 4);
        Assert.Equal((byte)'P', export.Body[0]);
        Assert.Equal((byte)'K', export.Body[1]);

        // The export is a valid import - proven into ANOTHER org's building, since
        // topics upsert by [organization, guid] and a same-org re-import would
        // just update the source topic in place.
        var orgB = await _fixture.ProvisionOrgAsync();
        var target = await InventoryScaffold.CreateBuildingAsync(_api, orgB.OwnerCookie);
        var import = await _api.PostMultipartAsync(
            $"v1/buildings/{target.BuildingId}/bcf/import",
            "file",
            "issues.bcfzip",
            [.. export.Body],
            orgB.OwnerCookie);
        Assert.Equal(HttpStatusCode.Created, import.Status);
        Assert.Equal(1, import.Data.GetProperty("topicsUpserted").GetInt32());

        var topics = await _api.GetAsync($"v1/buildings/{target.BuildingId}/bcf/topics", orgB.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, topics.Status);
        Assert.Contains(
            topics.Data.EnumerateArray(),
            t => t.GetProperty("title").GetString() == "Round-trip me");
    }

    [Fact]
    public async Task Importing_garbage_is_422_BCF_003()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var building = await InventoryScaffold.CreateBuildingAsync(_api, org.OwnerCookie);

        var response = await _api.PostMultipartAsync(
            $"v1/buildings/{building.BuildingId}/bcf/import",
            "file",
            "garbage.bcfzip",
            System.Text.Encoding.UTF8.GetBytes("this is not a zip archive"),
            org.OwnerCookie);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.Status);
        Assert.Equal("BCF_003", response.ErrorCode);
    }

    private async Task<string> CreateTopicAsync(ProvisionedOrg org, string buildingId, string title)
    {
        var create = await _api.PostAsync(
            $"v1/buildings/{buildingId}/bcf/topics",
            new { title },
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Created, create.Status);
        return InventoryScaffold.RequireId(create.Data);
    }
}
