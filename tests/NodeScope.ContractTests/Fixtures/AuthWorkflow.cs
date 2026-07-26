namespace NodeScope.ContractTests.Fixtures;

/// <summary>
/// A user established through the real sign-up flow. The session token is the one
/// credential form the native wire issues (raw Bearer token).
/// </summary>
/// <param name="UserId">The user's id.</param>
/// <param name="Email">The email the account was created with.</param>
/// <param name="Password">The password the account was created with.</param>
/// <param name="BearerToken">Raw session token, for <c>Authorization: Bearer</c>.</param>
/// <param name="User">The user object read back from <c>/api/v1/users/me</c>.</param>
public sealed record UserSession(
    string UserId,
    string Email,
    string Password,
    string BearerToken,
    JsonElement User)
{
    /// <summary>Bearer authentication for this session.</summary>
    public Auth AsBearer() => Auth.Bearer(BearerToken);
}

/// <summary>
/// Helpers that drive the native auth endpoints to establish test identities. Kept
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
    /// Signs up a brand-new user and returns its session. Asserts the documented
    /// sign-up contract along the way: 201 with the enveloped session token.
    /// </summary>
    public static async Task<UserSession> SignUpAsync(
        ApiClient api,
        string? email = null,
        string? name = null,
        CancellationToken cancellationToken = default)
    {
        email ??= NewEmail();
        var response = await api.PostAsync(
            "v1/auth/sign-up",
            new { name = name ?? "Contract Test User", email, password = DefaultPassword },
            cancellationToken: cancellationToken);

        Assert.Equal(HttpStatusCode.Created, response.Status);
        return await SessionFromAsync(api, response, email, DefaultPassword, cancellationToken);
    }

    /// <summary>
    /// Signs in an existing account and returns its session. Used for the seeded
    /// principals (e.g. the org owner) that already exist in the database.
    /// </summary>
    public static async Task<UserSession> SignInAsync(
        ApiClient api,
        string email,
        string password,
        CancellationToken cancellationToken = default)
    {
        var response = await api.PostAsync(
            "v1/auth/sign-in",
            new { email, password },
            cancellationToken: cancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.Status);
        return await SessionFromAsync(api, response, email, password, cancellationToken);
    }

    /// <summary>Signs in as the seeded org owner - an OWNER of the populated seed org.</summary>
    public static Task<UserSession> SignInAsSeedOwnerAsync(ApiClient api, CancellationToken cancellationToken = default) =>
        SignInAsync(api, TestConfig.SeedOwnerEmail, TestConfig.SeedOwnerPassword, cancellationToken);

    private static async Task<UserSession> SessionFromAsync(
        ApiClient api,
        ApiResponse response,
        string email,
        string password,
        CancellationToken cancellationToken)
    {
        var bearer = response.Data.GetProperty("token").GetString();
        Assert.False(string.IsNullOrEmpty(bearer), "auth response data carried no token");

        // The credential post returns only the token; the user shape lives on the one
        // pinned profile route.
        var me = await api.GetAsync("v1/users/me", Auth.Bearer(bearer!), cancellationToken);
        Assert.Equal(HttpStatusCode.OK, me.Status);
        var user = me.Data;
        var userId = user.GetProperty("id").GetString()
            ?? throw new InvalidOperationException("users/me returned no id");

        return new UserSession(userId, email, password, bearer!, user.Clone());
    }
}
