namespace NodeScope.ContractTests.Inventory;

/// <summary>
/// Contract for the property tree at <c>/api/v1/properties</c> - the site hierarchy
/// every other inventory resource hangs off. Covers the create/read/update/delete
/// envelope, the nesting rules (top-level must be a SITE; each type constrains its
/// children), sibling-name uniqueness, optimistic-concurrency conflict, the
/// not-empty delete guard, and the auth/org gates. Each test provisions its own
/// isolated org so trees never collide.
/// </summary>
[Collection(ContractSuite.Name)]
public class PropertiesContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public PropertiesContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task CreateTopLevelSite_returns_a_root_property_at_version_one()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var response = await _api.PostAsync(
            "v1/properties",
            new { type = "SITE", name = "HQ Campus" },
            org.OwnerAuth);

        Assert.Equal(HttpStatusCode.Created, response.Status);
        var property = response.Data;
        Assert.False(string.IsNullOrEmpty(property.GetProperty("id").GetString()));
        Assert.Equal("SITE", property.GetProperty("type").GetString());
        Assert.Equal("HQ Campus", property.GetProperty("name").GetString());
        Assert.Equal(JsonValueKind.Null, property.GetProperty("parentId").ValueKind);
        Assert.Equal(1, property.GetProperty("version").GetInt32());
    }

    [Fact]
    public async Task CreateBuildingUnderSite_nests_and_records_the_parent()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerAuth, "SITE");
        var siteId = InventoryScaffold.RequireId(site);

        var response = await _api.PostAsync(
            "v1/properties",
            new { type = "BUILDING", name = "Building A", parentId = siteId },
            org.OwnerAuth);

        Assert.Equal(HttpStatusCode.Created, response.Status);
        Assert.Equal("BUILDING", response.Data.GetProperty("type").GetString());
        Assert.Equal(siteId, response.Data.GetProperty("parentId").GetString());
    }

    [Fact]
    public async Task CreateNonSiteAtTopLevel_is_422_PROP_002()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var response = await _api.PostAsync(
            "v1/properties",
            new { type = "BUILDING", name = "Orphan Building" },
            org.OwnerAuth);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.Status);
        Assert.Equal("PROP_002", response.ErrorCode);
    }

    [Fact]
    public async Task CreateFloorDirectlyUnderSite_violates_nesting_with_422_PROP_002()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerAuth, "SITE");
        var siteId = InventoryScaffold.RequireId(site);

        // A FLOOR may sit under a BUILDING, never directly under a SITE.
        var response = await _api.PostAsync(
            "v1/properties",
            new { type = "FLOOR", name = "Level 1", parentId = siteId },
            org.OwnerAuth);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.Status);
        Assert.Equal("PROP_002", response.ErrorCode);
    }

    [Fact]
    public async Task ListProperties_returns_the_org_tree()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerAuth, "SITE");
        var siteId = InventoryScaffold.RequireId(site);

        var response = await _api.GetAsync("v1/properties", org.OwnerAuth);

        Assert.Equal(HttpStatusCode.OK, response.Status);
        Assert.Equal(JsonValueKind.Array, response.Data.ValueKind);
        Assert.Contains(response.Data.EnumerateArray(), p => p.GetProperty("id").GetString() == siteId);
    }

    [Fact]
    public async Task GetProperty_returns_the_property_and_unknown_ids_are_404_PROP_001()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerAuth, "SITE");
        var siteId = InventoryScaffold.RequireId(site);

        var found = await _api.GetAsync($"v1/properties/{siteId}", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, found.Status);
        Assert.Equal(siteId, found.Data.GetProperty("id").GetString());

        var missing = await _api.GetAsync($"v1/properties/{Guid.NewGuid()}", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, missing.Status);
        Assert.Equal("PROP_001", missing.ErrorCode);
    }

    [Fact]
    public async Task CreateSiblingWithATakenName_is_409_PROP_003()
    {
        var org = await _fixture.ProvisionOrgAsync();
        await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerAuth, "SITE", name: "Duplicate Site");

        var clash = await _api.PostAsync(
            "v1/properties",
            new { type = "SITE", name = "Duplicate Site" },
            org.OwnerAuth);

        Assert.Equal(HttpStatusCode.Conflict, clash.Status);
        Assert.Equal("PROP_003", clash.ErrorCode);
    }

    [Fact]
    public async Task PatchProperty_renames_and_bumps_the_version()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerAuth, "SITE");
        var siteId = InventoryScaffold.RequireId(site);
        var baseVersion = site.GetProperty("version").GetInt32();
        var newName = $"Renamed {Guid.NewGuid():N}";

        var patch = await _api.PatchAsync(
            $"v1/properties/{siteId}",
            new
            {
                baseVersion,
                changes = new[] { new { field = "name", oldValue = (string?)null, newValue = newName } },
            },
            org.OwnerAuth);

        Assert.Equal(HttpStatusCode.OK, patch.Status);
        Assert.Equal(newName, patch.Data.GetProperty("name").GetString());
        Assert.Equal(baseVersion + 1, patch.Data.GetProperty("version").GetInt32());
    }

    [Fact]
    public async Task PatchProperty_with_a_stale_base_version_is_409_SYNC_001()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerAuth, "SITE");
        var siteId = InventoryScaffold.RequireId(site);
        var baseVersion = site.GetProperty("version").GetInt32();

        var first = await _api.PatchAsync(
            $"v1/properties/{siteId}",
            new
            {
                baseVersion,
                changes = new[] { new { field = "name", oldValue = (string?)null, newValue = "First" } },
            },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, first.Status);

        var stale = await _api.PatchAsync(
            $"v1/properties/{siteId}",
            new
            {
                baseVersion,
                changes = new[] { new { field = "name", oldValue = (string?)null, newValue = "Second" } },
            },
            org.OwnerAuth);

        Assert.Equal(HttpStatusCode.Conflict, stale.Status);
        Assert.Equal("SYNC_001", stale.ErrorCode);
    }

    [Fact]
    public async Task DeleteLeafProperty_succeeds_and_a_non_empty_parent_is_409_PROP_004()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerAuth, "SITE");
        var siteId = InventoryScaffold.RequireId(site);
        var building = await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerAuth, "BUILDING", parentId: siteId);
        var buildingId = InventoryScaffold.RequireId(building);

        // The site now has a child, so it cannot be deleted.
        var blocked = await _api.DeleteAsync($"v1/properties/{siteId}", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Conflict, blocked.Status);
        Assert.Equal("PROP_004", blocked.ErrorCode);

        // The leaf building has nothing under it, so it deletes cleanly.
        var deleted = await _api.DeleteAsync($"v1/properties/{buildingId}", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, deleted.Status);
        Assert.Equal(JsonValueKind.Null, deleted.Data.ValueKind);

        var gone = await _api.GetAsync($"v1/properties/{buildingId}", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, gone.Status);
        Assert.Equal("PROP_001", gone.ErrorCode);
    }

    [Fact]
    public async Task ListProperties_for_a_user_with_no_org_is_403_ORG_002()
    {
        var loner = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.GetAsync("v1/properties", loner.AsBearer());

        Assert.Equal(HttpStatusCode.Forbidden, response.Status);
        Assert.Equal("ORG_002", response.ErrorCode);
    }

    [Fact]
    public async Task ListProperties_without_authentication_is_401_AUTH_002()
    {
        var response = await _api.GetAsync("v1/properties");

        Assert.Equal(HttpStatusCode.Unauthorized, response.Status);
        Assert.Equal("AUTH_002", response.ErrorCode);
    }
}
