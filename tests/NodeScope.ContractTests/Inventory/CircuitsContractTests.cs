namespace NodeScope.ContractTests.Inventory;

/// <summary>
/// Contract for <c>/api/v1/circuits</c> - the ISP circuits an org tracks, optionally
/// linked to a device. Covers the create/read/update/delete envelope, the
/// cursor-paginated list shape (<c>items</c>/<c>nextCursor</c>/<c>total</c>, distinct
/// from the devices list), the device-link path (and its <c>DEVICE_001</c> when the
/// device is unknown), optimistic-concurrency conflict, and the auth/org gates. Each
/// test provisions its own isolated org.
/// </summary>
[Collection(ContractSuite.Name)]
public class CircuitsContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public CircuitsContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task CreateCircuit_returns_a_device_less_circuit_at_version_one()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var response = await _api.PostAsync(
            "v1/circuits",
            new { ispName = "Acme Fiber", serviceType = "DIA", bandwidth = 1000 },
            org.OwnerCookie);

        Assert.Equal(HttpStatusCode.Created, response.Status);
        var circuit = response.Data;
        Assert.False(string.IsNullOrEmpty(circuit.GetProperty("id").GetString()));
        Assert.Equal("Acme Fiber", circuit.GetProperty("ispName").GetString());
        Assert.Equal("DIA", circuit.GetProperty("serviceType").GetString());
        Assert.Equal(JsonValueKind.Null, circuit.GetProperty("deviceId").ValueKind);
        Assert.Equal(1, circuit.GetProperty("version").GetInt32());
    }

    [Fact]
    public async Task CreateCircuit_linked_to_a_real_device_records_the_link()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var scaffold = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerCookie);
        var device = await InventoryScaffold.CreateDeviceAsync(
            _api, org.OwnerCookie, scaffold.NetworkId, scaffold.SiteId);
        var deviceId = InventoryScaffold.RequireId(device);

        var response = await _api.PostAsync(
            "v1/circuits",
            new { ispName = "Acme Fiber", serviceType = "DIA", deviceId },
            org.OwnerCookie);

        Assert.Equal(HttpStatusCode.Created, response.Status);
        Assert.Equal(deviceId, response.Data.GetProperty("deviceId").GetString());
    }

    [Fact]
    public async Task CreateCircuit_linked_to_an_unknown_device_is_404_DEVICE_001()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var response = await _api.PostAsync(
            "v1/circuits",
            new { ispName = "Acme Fiber", serviceType = "DIA", deviceId = Guid.NewGuid().ToString() },
            org.OwnerCookie);

        Assert.Equal(HttpStatusCode.NotFound, response.Status);
        Assert.Equal("DEVICE_001", response.ErrorCode);
    }

    [Fact]
    public async Task ListCircuits_is_cursor_paginated_and_counts_the_created_circuit()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var created = await _api.PostAsync(
            "v1/circuits",
            new { ispName = "Acme Fiber", serviceType = "DIA" },
            org.OwnerCookie);
        var circuitId = InventoryScaffold.RequireId(created.Data);

        var list = await _api.GetAsync("v1/circuits", org.OwnerCookie);

        Assert.Equal(HttpStatusCode.OK, list.Status);
        var page = list.Data;
        Assert.Equal(JsonValueKind.Array, page.GetProperty("items").ValueKind);
        Assert.True(page.GetProperty("total").GetInt32() >= 1);
        // A single circuit is well under a page, so there is no next cursor.
        Assert.Equal(JsonValueKind.Null, page.GetProperty("nextCursor").ValueKind);
        Assert.Contains(page.GetProperty("items").EnumerateArray(), c => c.GetProperty("id").GetString() == circuitId);
    }

    [Fact]
    public async Task GetCircuit_returns_the_circuit_and_unknown_ids_are_404_CIRCUIT_001()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var created = await _api.PostAsync(
            "v1/circuits",
            new { ispName = "Acme Fiber", serviceType = "DIA" },
            org.OwnerCookie);
        var circuitId = InventoryScaffold.RequireId(created.Data);

        var found = await _api.GetAsync($"v1/circuits/{circuitId}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, found.Status);
        Assert.Equal(circuitId, found.Data.GetProperty("id").GetString());

        var missing = await _api.GetAsync($"v1/circuits/{Guid.NewGuid()}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.NotFound, missing.Status);
        Assert.Equal("CIRCUIT_001", missing.ErrorCode);
    }

    [Fact]
    public async Task PatchCircuit_updates_a_field_and_bumps_the_version()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var created = await _api.PostAsync(
            "v1/circuits",
            new { ispName = "Acme Fiber", serviceType = "DIA" },
            org.OwnerCookie);
        var circuitId = InventoryScaffold.RequireId(created.Data);
        var baseVersion = created.Data.GetProperty("version").GetInt32();

        var patch = await _api.PatchAsync(
            $"v1/circuits/{circuitId}",
            new
            {
                baseVersion,
                changes = new[] { new { field = "notes", oldValue = (string?)null, newValue = "Provisioned 2026-07" } },
            },
            org.OwnerCookie);

        Assert.Equal(HttpStatusCode.OK, patch.Status);
        Assert.Equal("Provisioned 2026-07", patch.Data.GetProperty("notes").GetString());
        Assert.Equal(baseVersion + 1, patch.Data.GetProperty("version").GetInt32());
    }

    [Fact]
    public async Task PatchCircuit_with_a_stale_base_version_is_409_SYNC_001()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var created = await _api.PostAsync(
            "v1/circuits",
            new { ispName = "Acme Fiber", serviceType = "DIA" },
            org.OwnerCookie);
        var circuitId = InventoryScaffold.RequireId(created.Data);
        var baseVersion = created.Data.GetProperty("version").GetInt32();

        var first = await _api.PatchAsync(
            $"v1/circuits/{circuitId}",
            new
            {
                baseVersion,
                changes = new[] { new { field = "notes", oldValue = (string?)null, newValue = "First" } },
            },
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, first.Status);

        var stale = await _api.PatchAsync(
            $"v1/circuits/{circuitId}",
            new
            {
                baseVersion,
                changes = new[] { new { field = "notes", oldValue = (string?)null, newValue = "Second" } },
            },
            org.OwnerCookie);

        Assert.Equal(HttpStatusCode.Conflict, stale.Status);
        Assert.Equal("SYNC_001", stale.ErrorCode);
    }

    [Fact]
    public async Task DeleteCircuit_succeeds_and_a_second_delete_is_404_CIRCUIT_001()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var created = await _api.PostAsync(
            "v1/circuits",
            new { ispName = "Acme Fiber", serviceType = "DIA" },
            org.OwnerCookie);
        var circuitId = InventoryScaffold.RequireId(created.Data);

        var deleted = await _api.DeleteAsync($"v1/circuits/{circuitId}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, deleted.Status);
        Assert.Equal(JsonValueKind.Null, deleted.Data.ValueKind);

        var again = await _api.DeleteAsync($"v1/circuits/{circuitId}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.NotFound, again.Status);
        Assert.Equal("CIRCUIT_001", again.ErrorCode);
    }

    [Fact]
    public async Task ListCircuits_for_a_user_with_no_org_is_403_ORG_002()
    {
        var loner = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.GetAsync("v1/circuits", loner.AsBearer());

        Assert.Equal(HttpStatusCode.Forbidden, response.Status);
        Assert.Equal("ORG_002", response.ErrorCode);
    }

    [Fact]
    public async Task ListCircuits_without_authentication_is_401_AUTH_002()
    {
        var response = await _api.GetAsync("v1/circuits");

        Assert.Equal(HttpStatusCode.Unauthorized, response.Status);
        Assert.Equal("AUTH_002", response.ErrorCode);
    }
}
