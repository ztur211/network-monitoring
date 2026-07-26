namespace NodeScope.ContractTests.Inventory;

/// <summary>
/// Contract for <c>/api/v1/networks</c>. The load-bearing parity points here are the
/// one-network-per-org limit, the summary/detail split that keeps <c>homePublicIp</c>
/// out of the list but exposes it on the single-network read, and the
/// <c>set-home-ip</c> convenience that stamps the caller's request IP. CRUD envelope,
/// optimistic-concurrency conflict, and the auth/org gates round it out. Each test
/// provisions its own isolated org, so the per-org limit is always measured from zero.
/// </summary>
[Collection(ContractSuite.Name)]
public class NetworksContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public NetworksContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task CreateNetwork_returns_a_detail_with_homePublicIp_at_version_one()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var response = await _api.PostAsync(
            "v1/networks",
            new { name = "Primary WAN", isp = "Acme Fiber", homePublicIp = "203.0.113.7" },
            org.OwnerAuth);

        Assert.Equal(HttpStatusCode.Created, response.Status);
        var network = response.Data;
        Assert.False(string.IsNullOrEmpty(network.GetProperty("id").GetString()));
        Assert.Equal("Primary WAN", network.GetProperty("name").GetString());
        Assert.Equal("203.0.113.7", network.GetProperty("homePublicIp").GetString());
        Assert.Equal(1, network.GetProperty("version").GetInt32());
    }

    [Fact]
    public async Task CreateSecondNetwork_exceeds_the_per_org_limit_with_409_NETWORK_001()
    {
        var org = await _fixture.ProvisionOrgAsync();
        await InventoryScaffold.CreateNetworkAsync(_api, org.OwnerAuth);

        var second = await _api.PostAsync("v1/networks", new { name = "Second WAN" }, org.OwnerAuth);

        Assert.Equal(HttpStatusCode.Conflict, second.Status);
        Assert.Equal("NETWORK_001", second.ErrorCode);
    }

    [Fact]
    public async Task ListNetworks_returns_summaries_that_never_leak_homePublicIp()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var created = await _api.PostAsync(
            "v1/networks",
            new { name = "Summarised", homePublicIp = "198.51.100.4" },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, created.Status);
        var networkId = InventoryScaffold.RequireId(created.Data);

        var list = await _api.GetAsync("v1/networks", org.OwnerAuth);

        Assert.Equal(HttpStatusCode.OK, list.Status);
        Assert.Equal(JsonValueKind.Array, list.Data.ValueKind);
        var summary = list.Data.EnumerateArray()
            .Single(n => n.GetProperty("id").GetString() == networkId);
        // The list is a summary projection: the public IP is only ever revealed on GET :id.
        Assert.False(summary.TryGetProperty("homePublicIp", out _));

        var detail = await _api.GetAsync($"v1/networks/{networkId}", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, detail.Status);
        Assert.Equal("198.51.100.4", detail.Data.GetProperty("homePublicIp").GetString());
    }

    [Fact]
    public async Task GetNetwork_with_an_unknown_id_is_404_NETWORK_002()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var response = await _api.GetAsync($"v1/networks/{Guid.NewGuid()}", org.OwnerAuth);

        Assert.Equal(HttpStatusCode.NotFound, response.Status);
        Assert.Equal("NETWORK_002", response.ErrorCode);
    }

    [Fact]
    public async Task PatchNetwork_renames_and_bumps_the_version()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var network = await InventoryScaffold.CreateNetworkAsync(_api, org.OwnerAuth);
        var networkId = InventoryScaffold.RequireId(network);
        var baseVersion = network.GetProperty("version").GetInt32();
        var newName = $"Renamed {Guid.NewGuid():N}";

        var patch = await _api.PatchAsync(
            $"v1/networks/{networkId}",
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
    public async Task PatchNetwork_with_a_stale_base_version_is_409_SYNC_001()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var network = await InventoryScaffold.CreateNetworkAsync(_api, org.OwnerAuth);
        var networkId = InventoryScaffold.RequireId(network);
        var baseVersion = network.GetProperty("version").GetInt32();

        var first = await _api.PatchAsync(
            $"v1/networks/{networkId}",
            new
            {
                baseVersion,
                changes = new[] { new { field = "isp", oldValue = (string?)null, newValue = "First ISP" } },
            },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, first.Status);

        var stale = await _api.PatchAsync(
            $"v1/networks/{networkId}",
            new
            {
                baseVersion,
                changes = new[] { new { field = "isp", oldValue = (string?)null, newValue = "Second ISP" } },
            },
            org.OwnerAuth);

        Assert.Equal(HttpStatusCode.Conflict, stale.Status);
        Assert.Equal("SYNC_001", stale.ErrorCode);
    }

    [Fact]
    public async Task SetHomeIp_stamps_the_request_ip_onto_the_network()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var network = await InventoryScaffold.CreateNetworkAsync(_api, org.OwnerAuth);
        var networkId = InventoryScaffold.RequireId(network);

        var response = await _api.PostAsync($"v1/networks/{networkId}/set-home-ip", null, org.OwnerAuth);

        Assert.Equal(HttpStatusCode.OK, response.Status);
        // The server derives the IP from the request itself; the contract is that the
        // field is populated (non-null) and the version advances from the create.
        Assert.Equal(JsonValueKind.String, response.Data.GetProperty("homePublicIp").ValueKind);
        Assert.True(response.Data.GetProperty("version").GetInt32() > network.GetProperty("version").GetInt32());
    }

    [Fact]
    public async Task DeleteNetwork_succeeds_and_a_second_delete_is_404_NETWORK_002()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var network = await InventoryScaffold.CreateNetworkAsync(_api, org.OwnerAuth);
        var networkId = InventoryScaffold.RequireId(network);

        var deleted = await _api.DeleteAsync($"v1/networks/{networkId}", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, deleted.Status);
        Assert.Equal(JsonValueKind.Null, deleted.Data.ValueKind);

        var again = await _api.DeleteAsync($"v1/networks/{networkId}", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, again.Status);
        Assert.Equal("NETWORK_002", again.ErrorCode);
    }

    [Fact]
    public async Task ListNetworks_for_a_user_with_no_org_is_403_ORG_002()
    {
        var loner = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.GetAsync("v1/networks", loner.AsBearer());

        Assert.Equal(HttpStatusCode.Forbidden, response.Status);
        Assert.Equal("ORG_002", response.ErrorCode);
    }

    [Fact]
    public async Task ListNetworks_without_authentication_is_401_AUTH_002()
    {
        var response = await _api.GetAsync("v1/networks");

        Assert.Equal(HttpStatusCode.Unauthorized, response.Status);
        Assert.Equal("AUTH_002", response.ErrorCode);
    }
}
