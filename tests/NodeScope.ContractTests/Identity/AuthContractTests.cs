namespace NodeScope.ContractTests.Identity;

/// <summary>
/// Contract for the native auth surface at <c>/api/v1/auth</c> and the
/// session-protected <c>/api/v1/users/me</c>. A
/// credential post answers with the envelope carrying only <c>{ token }</c>; the raw
/// token as <c>Authorization: Bearer</c> is the one session credential - no cookies
/// exist on this wire.
/// </summary>
[Collection(ContractSuite.Name)]
public class AuthContractTests
{
    private readonly ApiClient _api;

    public AuthContractTests(ContractApiFixture fixture) => _api = fixture.Api;

    [Fact]
    public async Task SignUp_answers_201_with_a_working_token_and_a_free_tier_user()
    {
        var email = AuthWorkflow.NewEmail();

        var response = await _api.PostAsync(
            "v1/auth/sign-up",
            new { name = "E2E Auth User", email, password = AuthWorkflow.DefaultPassword });

        Assert.Equal(HttpStatusCode.Created, response.Status);
        Assert.True(response.Json.GetProperty("success").GetBoolean());
        var token = response.Data.GetProperty("token").GetString();
        Assert.False(string.IsNullOrEmpty(token));

        var me = await _api.GetAsync("v1/users/me", Auth.Bearer(token!));
        Assert.Equal(HttpStatusCode.OK, me.Status);
        Assert.Equal(email, me.Data.GetProperty("email").GetString());
        Assert.Equal("PERSONAL_FREE", me.Data.GetProperty("tier").GetString());
    }

    [Fact]
    public async Task SignUp_with_a_taken_email_is_409_AUTH_005()
    {
        var user = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.PostAsync(
            "v1/auth/sign-up",
            new { name = "Second Account", email = user.Email, password = AuthWorkflow.DefaultPassword });

        Assert.Equal(HttpStatusCode.Conflict, response.Status);
        Assert.Equal("AUTH_005", response.ErrorCode);
    }

    [Fact]
    public async Task SignUp_with_a_short_password_is_400_GEN_001()
    {
        var response = await _api.PostAsync(
            "v1/auth/sign-up",
            new { name = "Short Password", email = AuthWorkflow.NewEmail(), password = "short" });

        Assert.Equal(HttpStatusCode.BadRequest, response.Status);
        Assert.Equal("GEN_001", response.ErrorCode);
    }

    [Fact]
    public async Task SignIn_with_valid_credentials_returns_a_fresh_working_session()
    {
        var user = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.PostAsync(
            "v1/auth/sign-in",
            new { email = user.Email, password = user.Password });

        Assert.Equal(HttpStatusCode.OK, response.Status);
        var token = response.Data.GetProperty("token").GetString();
        Assert.False(string.IsNullOrEmpty(token));
        Assert.NotEqual(user.BearerToken, token); // a fresh session, not the sign-up one

        var me = await _api.GetAsync("v1/users/me", Auth.Bearer(token!));
        Assert.Equal(user.Email, me.Data.GetProperty("email").GetString());
    }

    [Fact]
    public async Task SignIn_with_a_wrong_password_is_401_AUTH_001()
    {
        var user = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.PostAsync(
            "v1/auth/sign-in",
            new { email = user.Email, password = "WrongPassword123!" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.Status);
        Assert.Equal("AUTH_001", response.ErrorCode);
    }

    [Fact]
    public async Task SignIn_with_an_unknown_email_is_the_same_401_AUTH_001()
    {
        var response = await _api.PostAsync(
            "v1/auth/sign-in",
            new { email = AuthWorkflow.NewEmail("nobody"), password = AuthWorkflow.DefaultPassword });

        Assert.Equal(HttpStatusCode.Unauthorized, response.Status);
        Assert.Equal("AUTH_001", response.ErrorCode);
    }

    [Fact]
    public async Task UsersMe_with_a_bearer_token_is_authenticated()
    {
        var user = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.GetAsync("v1/users/me", user.AsBearer());

        Assert.Equal(HttpStatusCode.OK, response.Status);
        Assert.Equal(user.Email, response.Data.GetProperty("email").GetString());
    }

    [Fact]
    public async Task UsersMe_without_authentication_is_401_AUTH_002()
    {
        var response = await _api.GetAsync("v1/users/me");

        Assert.Equal(HttpStatusCode.Unauthorized, response.Status);
        Assert.Equal("AUTH_002", response.ErrorCode);
    }

    [Fact]
    public async Task SignOut_revokes_the_session_and_is_401_when_repeated()
    {
        var user = await AuthWorkflow.SignUpAsync(_api);

        var signOut = await _api.PostAsync("v1/auth/sign-out", auth: user.AsBearer());
        Assert.Equal(HttpStatusCode.NoContent, signOut.Status);

        // The token is dead everywhere at once - no cookie cache to outlive it.
        var afterSignOut = await _api.GetAsync("v1/users/me", user.AsBearer());
        Assert.Equal(HttpStatusCode.Unauthorized, afterSignOut.Status);

        var repeated = await _api.PostAsync("v1/auth/sign-out", auth: user.AsBearer());
        Assert.Equal(HttpStatusCode.Unauthorized, repeated.Status);
        Assert.Equal("AUTH_002", repeated.ErrorCode);
    }
}
