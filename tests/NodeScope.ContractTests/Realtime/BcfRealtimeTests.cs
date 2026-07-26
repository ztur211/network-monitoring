using NodeScope.ContractTests.Inventory;

namespace NodeScope.ContractTests.Realtime;

/// <summary>
/// Contract for the BCF topic events, scoped to the building the topic lives on. The
/// created and updated events carry the full topic DTO (not just an id), and the
/// comment event carries the new comment itself alongside its topic id - the payloads
/// clients render from directly, so their shape is the contract.
/// </summary>
[Collection(ContractSuite.Name)]
public class BcfRealtimeTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public BcfRealtimeTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Owner_socket_receives_bcf_topic_created_when_a_topic_is_created()
    {
        var (org, buildingId) = await OrgWithBuildingAsync();
        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerAuth);

        var title = $"topic-{Guid.NewGuid():N}";
        var create = await _api.PostAsync($"v1/buildings/{buildingId}/bcf/topics", new { title }, org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, create.Status);
        var topicId = InventoryScaffold.RequireId(create.Data);

        var evt = await socket.WaitForEventAsync("v1:bcf:topic:created", p => TopicIdIs(p, topicId));
        Assert.Equal(title, evt.GetProperty("topic").GetProperty("title").GetString());
        Assert.True(evt.TryGetProperty("timestamp", out _));
    }

    [Fact]
    public async Task Owner_socket_receives_bcf_topic_updated_when_a_topic_is_patched()
    {
        var (org, buildingId) = await OrgWithBuildingAsync();
        var create = await _api.PostAsync(
            $"v1/buildings/{buildingId}/bcf/topics",
            new { title = $"topic-{Guid.NewGuid():N}" },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, create.Status);
        var topicId = InventoryScaffold.RequireId(create.Data);
        var baseVersion = create.Data.GetProperty("version").GetInt32();

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerAuth);

        var newTitle = $"topic-{Guid.NewGuid():N}";
        var patch = await _api.PatchAsync($"v1/bcf/topics/{topicId}", new { baseVersion, title = newTitle }, org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, patch.Status);

        var evt = await socket.WaitForEventAsync("v1:bcf:topic:updated", p => TopicIdIs(p, topicId));
        Assert.Equal(newTitle, evt.GetProperty("topic").GetProperty("title").GetString());
    }

    [Fact]
    public async Task Owner_socket_receives_bcf_comment_added_when_a_comment_is_added()
    {
        var (org, buildingId) = await OrgWithBuildingAsync();
        var create = await _api.PostAsync(
            $"v1/buildings/{buildingId}/bcf/topics",
            new { title = $"topic-{Guid.NewGuid():N}" },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, create.Status);
        var topicId = InventoryScaffold.RequireId(create.Data);

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerAuth);

        var text = $"comment-{Guid.NewGuid():N}";
        var comment = await _api.PostAsync($"v1/bcf/topics/{topicId}/comments", new { comment = text }, org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, comment.Status);

        var evt = await socket.WaitForEventAsync(
            "v1:bcf:comment:added",
            p => p.TryGetProperty("topicId", out var t) && t.GetString() == topicId);
        Assert.Equal(text, evt.GetProperty("comment").GetProperty("comment").GetString());
    }

    /// <summary>A SITE with a BUILDING under it - the property a BCF topic must live on.</summary>
    private async Task<(ProvisionedOrg Org, string BuildingId)> OrgWithBuildingAsync()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerAuth);
        var building = await InventoryScaffold.CreatePropertyAsync(
            _api, org.OwnerAuth, "BUILDING", parentId: InventoryScaffold.RequireId(site));
        return (org, InventoryScaffold.RequireId(building));
    }

    private static bool TopicIdIs(JsonElement payload, string topicId) =>
        payload.TryGetProperty("topic", out var topic)
        && topic.TryGetProperty("id", out var id)
        && id.GetString() == topicId;
}
