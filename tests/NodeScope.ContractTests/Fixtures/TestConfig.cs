namespace NodeScope.ContractTests.Fixtures;

/// <summary>
/// Resolves the single knob this suite is allowed to know about: the base URL of
/// the API under test. Decision 4 - the contract suite talks to a BASE_URL over
/// HTTP and references no implementation, so the same tests point at the NestJS
/// API today and the C# host as modules land, chosen purely by this environment
/// variable.
/// </summary>
internal static class TestConfig
{
    /// <summary>Environment variable naming the target, e.g. <c>http://localhost:3000</c>.</summary>
    public const string BaseUrlVariable = "NODESCOPE_BASE_URL";

    private const string DefaultBaseUrl = "http://localhost:3000";

    /// <summary>
    /// The target origin with no trailing slash. The fixture appends <c>/api/</c>
    /// (the global prefix set in <c>main.ts</c>) to form the client base address.
    /// </summary>
    public static string BaseUrl
    {
        get
        {
            var configured = Environment.GetEnvironmentVariable(BaseUrlVariable);
            var value = string.IsNullOrWhiteSpace(configured) ? DefaultBaseUrl : configured.Trim();
            return value.TrimEnd('/');
        }
    }

    /// <summary>
    /// Email of the seeded org owner - an OWNER of the populated seed organization,
    /// created by <c>apps/api/prisma/seed.ts</c>. Overridable for a differently
    /// seeded target.
    /// </summary>
    public static string SeedOwnerEmail =>
        Environment.GetEnvironmentVariable("NODESCOPE_SEED_OWNER_EMAIL") ?? "owner@acme.test";

    /// <summary>Password for <see cref="SeedOwnerEmail"/> (the seed's <c>SEED_PASSWORD</c>).</summary>
    public static string SeedOwnerPassword =>
        Environment.GetEnvironmentVariable("NODESCOPE_SEED_OWNER_PASSWORD") ?? "devpassword123";
}
