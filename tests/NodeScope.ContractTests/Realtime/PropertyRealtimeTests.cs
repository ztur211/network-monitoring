using NodeScope.ContractTests.Inventory;

namespace NodeScope.ContractTests.Realtime;

/// <summary>
/// Contract for the property-tree events (updated / moved / deleted) and the network
/// charter events (added / removed). The parity-worthy split: a rename emits
/// property:updated, but a reparent emits property:moved INSTEAD - fanned out to both
/// the property's own scope and the old parent's - and must not also emit updated.
/// Charter events fan out to every chartered site of the network plus the site being
/// (un)chartered; the OWNER socket sees all of it from the owner room.
/// </summary>
[Collection(ContractSuite.Name)]
public class PropertyRealtimeTests
{
    private static readonly TimeSpan NegativeWindow = TimeSpan.FromSeconds(2);

    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public PropertyRealtimeTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Owner_socket_receives_property_updated_when_a_property_is_renamed()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerAuth);
        var siteId = InventoryScaffold.RequireId(site);

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerAuth);

        await PatchPropertyAsync(siteId, site.GetProperty("version").GetInt32(), "name", $"rt-{Guid.NewGuid():N}", org.OwnerAuth);

        var evt = await socket.WaitForEventAsync("v1:property:updated", p => IdIs(p, siteId));
        Assert.Equal(siteId, evt.GetProperty("id").GetString());
        Assert.True(evt.TryGetProperty("timestamp", out _));
    }

    [Fact]
    public async Task Owner_socket_receives_property_moved_not_updated_when_a_property_is_reparented()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var oldSite = await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerAuth);
        var oldSiteId = InventoryScaffold.RequireId(oldSite);
        var newSite = await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerAuth);
        var newSiteId = InventoryScaffold.RequireId(newSite);
        var building = await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerAuth, "BUILDING", parentId: oldSiteId);
        var buildingId = InventoryScaffold.RequireId(building);

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerAuth);

        await PatchPropertyAsync(buildingId, building.GetProperty("version").GetInt32(), "parentId", newSiteId, org.OwnerAuth);

        var evt = await socket.WaitForEventAsync("v1:property:moved", p => IdIs(p, buildingId));
        Assert.Equal(buildingId, evt.GetProperty("id").GetString());

        // The reparent path emits moved INSTEAD of updated, not alongside it.
        await Assert.ThrowsAsync<TimeoutException>(
            () => socket.WaitForEventAsync("v1:property:updated", p => IdIs(p, buildingId), NegativeWindow));
    }

    [Fact]
    public async Task Owner_socket_receives_property_deleted_when_a_property_is_deleted()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerAuth);
        var siteId = InventoryScaffold.RequireId(site);

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerAuth);

        var deleted = await _api.DeleteAsync($"v1/properties/{siteId}", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, deleted.Status);

        var evt = await socket.WaitForEventAsync("v1:property:deleted", p => IdIs(p, siteId));
        Assert.Equal(siteId, evt.GetProperty("id").GetString());
    }

    [Fact]
    public async Task Owner_socket_receives_charter_added_when_a_site_is_chartered()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerAuth);
        var siteId = InventoryScaffold.RequireId(site);
        var network = await InventoryScaffold.CreateNetworkAsync(_api, org.OwnerAuth);
        var networkId = InventoryScaffold.RequireId(network);

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerAuth);

        var charter = await _api.PostAsync(
            $"v1/networks/{networkId}/properties",
            new { propertyId = siteId },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, charter.Status);
        var charterId = InventoryScaffold.RequireId(charter.Data);

        var evt = await socket.WaitForEventAsync(
            "v1:network:charter:added",
            p => p.TryGetProperty("propertyId", out var pid) && pid.GetString() == siteId);
        Assert.Equal(charterId, evt.GetProperty("id").GetString());
        Assert.Equal(networkId, evt.GetProperty("networkId").GetString());
    }

    [Fact]
    public async Task Owner_socket_receives_charter_removed_when_a_charter_is_removed()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var scaffold = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerAuth);

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerAuth);

        // No devices sit under the site, so the charter is removable.
        var remove = await _api.DeleteAsync(
            $"v1/networks/{scaffold.NetworkId}/properties/{scaffold.SiteId}",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, remove.Status);

        var evt = await socket.WaitForEventAsync(
            "v1:network:charter:removed",
            p => p.TryGetProperty("propertyId", out var pid) && pid.GetString() == scaffold.SiteId);
        Assert.Equal(scaffold.NetworkId, evt.GetProperty("networkId").GetString());
        // Unlike charter:added, the removal payload carries no charter id - just the pair.
        Assert.False(evt.TryGetProperty("id", out _));
    }

    private static bool IdIs(JsonElement payload, string id) =>
        payload.TryGetProperty("id", out var i) && i.GetString() == id;

    /// <summary>Patches one field of a property through the shared changeset envelope.</summary>
    private async Task PatchPropertyAsync(string propertyId, int baseVersion, string field, string newValue, Auth auth)
    {
        var patch = await _api.PatchAsync(
            $"v1/properties/{propertyId}",
            new
            {
                baseVersion,
                changes = new[] { new { field, oldValue = (string?)null, newValue } },
            },
            auth);
        Assert.Equal(HttpStatusCode.OK, patch.Status);
    }
}
