namespace NodeScope.ContractTests.Fixtures;

/// <summary>
/// A user established through the real sign-up flow, carrying both credential forms
/// the API issues so a test can exercise either the cookie or the Bearer path.
/// </summary>
/// <param name="UserId">The user's id.</param>
/// <param name="Email">The email the account was created with.</param>
/// <param name="Password">The password the account was created with.</param>
/// <param name="BearerToken">Raw session token, for <c>Authorization: Bearer</c> (the <c>set-auth-token</c> header).</param>
/// <param name="Cookie">The <c>better-auth.session_token</c> cookie as <c>name=value</c>.</param>
/// <param name="User">The <c>user</c> object returned by sign-up.</param>
public sealed record UserSession(
    string UserId,
    string Email,
    string Password,
    string BearerToken,
    string Cookie,
    JsonElement User)
{
    /// <summary>Cookie-based authentication for this session.</summary>
    public Auth AsCookie() => Auth.WithCookie(Cookie);

    /// <summary>Bearer-based authentication for this session.</summary>
    public Auth AsBearer() => Auth.Bearer(BearerToken);
}

/// <summary>
/// Helpers that drive Better Auth's endpoints to establish test identities. Kept
/// out of the fixture so every test can mint the users it needs with unique
/// emails, rather than sharing one seeded account that tests would have to reset.
/// </summary>
public static class AuthWorkflow
{
    /// <summary>Password meeting the configured policy, reused across the suite.</summary>
    public const string DefaultPassword = "Password123!";

    /// <summary>A fresh, collision-free email so sign-up never races another test.</summary>
    public static string NewEmail(string prefix = "contract") => $"{prefix}-{Guid.NewGuid():N}@example.com";

    /// <summary>
    /// Signs up a brand-new user and returns both credential forms. Asserts the
    /// documented sign-up contract along the way: 200, a session cookie, and the
    /// <c>set-auth-token</c> Bearer header.
    /// </summary>
    public static async Task<UserSession> SignUpAsync(
        ApiClient api,
        string? email = null,
        string? name = null,
        CancellationToken cancellationToken = default)
    {
        email ??= NewEmail();
        var response = await api.PostAsync(
            "auth/sign-up/email",
            new { email, password = DefaultPassword, name = name ?? "Contract Test User" },
            cancellationToken: cancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.Status);
        return SessionFrom(response, email, DefaultPassword);
    }

    /// <summary>
    /// Signs in an existing account and returns both credential forms. Used for the
    /// seeded principals (e.g. the org owner) that already exist in the database.
    /// </summary>
    public static async Task<UserSession> SignInAsync(
        ApiClient api,
        string email,
        string password,
        CancellationToken cancellationToken = default)
    {
        var response = await api.PostAsync(
            "auth/sign-in/email",
            new { email, password },
            cancellationToken: cancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.Status);
        return SessionFrom(response, email, password);
    }

    /// <summary>Signs in as the seeded org owner - an OWNER of the populated seed org.</summary>
    public static Task<UserSession> SignInAsSeedOwnerAsync(ApiClient api, CancellationToken cancellationToken = default) =>
        SignInAsync(api, TestConfig.SeedOwnerEmail, TestConfig.SeedOwnerPassword, cancellationToken);

    private static UserSession SessionFrom(ApiResponse response, string email, string password)
    {
        var bearer = response.Header("set-auth-token")
            ?? throw new InvalidOperationException("auth response is missing the set-auth-token header");
        var cookie = response.SessionTokenCookie
            ?? throw new InvalidOperationException("auth response did not set the session cookie");

        var user = response.Json.GetProperty("user");
        var userId = user.GetProperty("id").GetString()
            ?? throw new InvalidOperationException("auth response user has no id");

        return new UserSession(userId, email, password, bearer, cookie, user.Clone());
    }
}
