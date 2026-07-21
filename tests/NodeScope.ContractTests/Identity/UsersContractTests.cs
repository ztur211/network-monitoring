namespace NodeScope.ContractTests.Identity;

/// <summary>
/// Contract for the self-service user surface at <c>/api/v1/users/*</c> that needs no
/// org context: reading and updating one's own profile and UI preferences. Each test
/// works against a fresh account so its mutations never touch another test's state.
/// </summary>
[Collection(ContractSuite.Name)]
public class UsersContractTests
{
    private readonly ApiClient _api;

    public UsersContractTests(ContractApiFixture fixture) => _api = fixture.Api;

    [Fact]
    public async Task PatchMe_updates_the_display_name_and_echoes_it_in_the_envelope()
    {
        var user = await AuthWorkflow.SignUpAsync(_api, name: "Before");

        var response = await _api.PatchAsync("v1/users/me", new { name = "After" }, user.AsBearer());

        Assert.Equal(HttpStatusCode.OK, response.Status);
        Assert.True(response.Json.GetProperty("success").GetBoolean());
        Assert.Equal("After", response.Data.GetProperty("name").GetString());
        Assert.Equal(user.Email, response.Data.GetProperty("email").GetString());
    }

    [Fact]
    public async Task GetPreferences_for_a_new_user_returns_an_empty_preferences_object()
    {
        var user = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.GetAsync("v1/users/me/preferences", user.AsBearer());

        Assert.Equal(HttpStatusCode.OK, response.Status);
        Assert.Equal(JsonValueKind.Object, response.Data.GetProperty("preferences").ValueKind);
    }

    [Fact]
    public async Task PutPreferences_persists_values_that_a_later_get_reads_back()
    {
        var user = await AuthWorkflow.SignUpAsync(_api);

        var put = await _api.PutAsync(
            "v1/users/me/preferences",
            new { buildingsVisible = false, mapZoom = 12 },
            user.AsBearer());

        Assert.Equal(HttpStatusCode.OK, put.Status);
        var written = put.Data.GetProperty("preferences");
        Assert.False(written.GetProperty("buildingsVisible").GetBoolean());
        Assert.Equal(12, written.GetProperty("mapZoom").GetInt32());

        var get = await _api.GetAsync("v1/users/me/preferences", user.AsBearer());
        var read = get.Data.GetProperty("preferences");
        Assert.False(read.GetProperty("buildingsVisible").GetBoolean());
        Assert.Equal(12, read.GetProperty("mapZoom").GetInt32());
    }

    [Fact]
    public async Task GetMe_without_authentication_is_401_AUTH_002()
    {
        var response = await _api.GetAsync("v1/users/me/preferences");

        Assert.Equal(HttpStatusCode.Unauthorized, response.Status);
        Assert.Equal("AUTH_002", response.ErrorCode);
    }
}
