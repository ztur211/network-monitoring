namespace NodeScope.ContractTests.Identity;

/// <summary>
/// Contract for the two users endpoints outside the me/preferences core: the home
/// location write and the data-sources status read. Location accepts an explicit
/// lat/lng pair (200, echoed with a null address) and rejects an empty body with
/// GEN_001 - the address branch geocodes through an external provider, so only
/// its validation layer is pinned here, not the network-dependent lookup.
/// Data-sources needs org context and reports the browser collector's status.
/// </summary>
[Collection(ContractSuite.Name)]
public class UsersExtrasContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public UsersExtrasContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Location_with_coordinates_echoes_them_and_persists_to_the_profile()
    {
        var user = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.PostAsync(
            "v1/users/location",
            new { latitude = 40.7128, longitude = -74.0060 },
            user.AsCookie());

        Assert.Equal(HttpStatusCode.OK, response.Status);
        Assert.Equal(40.7128, response.Data.GetProperty("latitude").GetDouble());
        Assert.Equal(-74.0060, response.Data.GetProperty("longitude").GetDouble());
        Assert.Equal(JsonValueKind.Null, response.Data.GetProperty("address").ValueKind);

        var me = await _api.GetAsync("v1/users/me", user.AsCookie());
        Assert.Equal(HttpStatusCode.OK, me.Status);
        Assert.Equal(40.7128, me.Data.GetProperty("homeLatitude").GetDouble());
        Assert.Equal(-74.0060, me.Data.GetProperty("homeLongitude").GetDouble());
    }

    [Fact]
    public async Task Location_without_address_or_coordinates_is_400_GEN_001()
    {
        var user = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.PostAsync("v1/users/location", new { }, user.AsCookie());

        Assert.Equal(HttpStatusCode.BadRequest, response.Status);
        Assert.Equal("GEN_001", response.ErrorCode);
    }

    [Fact]
    public async Task Location_with_an_out_of_range_latitude_is_400_GEN_001()
    {
        var user = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.PostAsync(
            "v1/users/location",
            new { latitude = 95.0, longitude = 0.0 },
            user.AsCookie());

        Assert.Equal(HttpStatusCode.BadRequest, response.Status);
        Assert.Equal("GEN_001", response.ErrorCode);
    }

    [Fact]
    public async Task DataSources_reports_the_browser_collector_disconnected_for_a_fresh_owner()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var response = await _api.GetAsync("v1/users/me/data-sources", org.OwnerCookie);

        Assert.Equal(HttpStatusCode.OK, response.Status);
        var sources = response.Data.GetProperty("sources");
        var browser = sources.EnumerateArray().Single(s => s.GetProperty("type").GetString() == "browser");
        Assert.False(browser.GetProperty("connected").GetBoolean());
        Assert.Equal(JsonValueKind.Null, browser.GetProperty("lastSeen").ValueKind);
        Assert.False(string.IsNullOrEmpty(browser.GetProperty("message").GetString()));
    }

    [Fact]
    public async Task DataSources_requires_org_context()
    {
        var orgless = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.GetAsync("v1/users/me/data-sources", orgless.AsCookie());

        Assert.Equal(HttpStatusCode.Forbidden, response.Status);
        Assert.Equal("ORG_002", response.ErrorCode);
    }
}
