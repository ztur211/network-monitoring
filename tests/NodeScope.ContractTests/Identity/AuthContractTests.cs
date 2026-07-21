namespace NodeScope.ContractTests.Identity;

/// <summary>
/// Contract for the Better Auth surface mounted at <c>/api/auth/*</c> and the
/// session-protected <c>/api/v1/users/me</c>. Black-box translation of
/// <c>apps/api/src/auth/__tests__/auth.e2e.ts</c>: the original boots Nest
/// in-process, this asserts the same behaviour over HTTP so it can be pointed at
/// the C# host unchanged after cutover.
/// </summary>
[Collection(ContractSuite.Name)]
public class AuthContractTests
{
    private readonly ApiClient _api;

    public AuthContractTests(ContractApiFixture fixture) => _api = fixture.Api;

    [Fact]
    public async Task SignUp_creates_user_on_the_free_tier_with_a_cookie_and_bearer_token()
    {
        var email = AuthWorkflow.NewEmail();

        var response = await _api.PostAsync(
            "auth/sign-up/email",
            new { email, password = AuthWorkflow.DefaultPassword, name = "E2E Auth User" });

        Assert.Equal(HttpStatusCode.OK, response.Status);

        var user = response.Json.GetProperty("user");
        Assert.Equal(email, user.GetProperty("email").GetString());
        Assert.Equal("PERSONAL_FREE", user.GetProperty("tier").GetString());

        // The session is issued both ways: a cookie for the browser and the
        // set-auth-token header for the bearer plugin.
        Assert.NotNull(response.SessionTokenCookie);
        Assert.False(string.IsNullOrEmpty(response.Header("set-auth-token")));
    }

    [Fact]
    public async Task SignIn_with_valid_credentials_returns_the_user_and_a_fresh_session()
    {
        var user = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.PostAsync(
            "auth/sign-in/email",
            new { email = user.Email, password = user.Password });

        Assert.Equal(HttpStatusCode.OK, response.Status);
        Assert.Equal(user.Email, response.Json.GetProperty("user").GetProperty("email").GetString());
        Assert.NotNull(response.SessionTokenCookie);
    }

    [Fact]
    public async Task SignIn_with_a_wrong_password_is_rejected()
    {
        var user = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.PostAsync(
            "auth/sign-in/email",
            new { email = user.Email, password = "WrongPassword123!" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.Status);
    }

    [Fact]
    public async Task GetSession_with_a_valid_cookie_returns_the_signed_in_user()
    {
        var user = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.GetAsync("auth/get-session", user.AsCookie());

        Assert.Equal(HttpStatusCode.OK, response.Status);
        Assert.Equal(user.Email, response.Json.GetProperty("user").GetProperty("email").GetString());
        Assert.Equal("PERSONAL_FREE", response.Json.GetProperty("user").GetProperty("tier").GetString());
    }

    [Fact]
    public async Task UsersMe_with_a_cookie_returns_the_success_envelope()
    {
        var user = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.GetAsync("v1/users/me", user.AsCookie());

        Assert.Equal(HttpStatusCode.OK, response.Status);
        Assert.True(response.Json.GetProperty("success").GetBoolean());
        Assert.Equal(user.Email, response.Data.GetProperty("email").GetString());
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
    public async Task RequestPasswordReset_for_an_unknown_email_returns_200_to_avoid_enumeration()
    {
        var response = await _api.PostAsync(
            "auth/request-password-reset",
            new { email = "nonexistent@example.com", redirectTo = "http://localhost:8081/reset" });

        Assert.Equal(HttpStatusCode.OK, response.Status);
    }

    [Fact]
    public async Task SignOut_clears_the_session_so_get_session_returns_null()
    {
        var user = await AuthWorkflow.SignUpAsync(_api);

        var signOut = await _api.PostAsync("auth/sign-out", auth: user.AsCookie());
        Assert.Equal(HttpStatusCode.OK, signOut.Status);

        var afterSignOut = await _api.GetAsync("auth/get-session", user.AsCookie());
        Assert.Equal(HttpStatusCode.OK, afterSignOut.Status);
        Assert.Equal(JsonValueKind.Null, afterSignOut.Json.ValueKind);
    }
}
