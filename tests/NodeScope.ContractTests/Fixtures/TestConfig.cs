namespace NodeScope.ContractTests.Fixtures;

/// <summary>
/// Resolves the single target knob the black-box suite knows: the base URL of
/// the appliance under test. The suite references no implementation project.
/// </summary>
internal static class TestConfig
{
    /// <summary>Environment variable naming the target, e.g. <c>http://localhost:3000</c>.</summary>
    public const string BaseUrlVariable = "NODESCOPE_BASE_URL";

    private const string DefaultBaseUrl = "http://127.0.0.1:5199";

    /// <summary>
    /// The target origin with no trailing slash. The fixture appends <c>/api/</c>
    /// to form the client base address.
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
    /// created by the API seed command. Overridable for a differently seeded target.
    /// </summary>
    public static string SeedOwnerEmail =>
        Environment.GetEnvironmentVariable("NODESCOPE_SEED_OWNER_EMAIL") ?? "owner@acme.test";

    /// <summary>Password for <see cref="SeedOwnerEmail"/> (the seed's <c>SEED_PASSWORD</c>).</summary>
    public static string SeedOwnerPassword =>
        Environment.GetEnvironmentVariable("NODESCOPE_SEED_OWNER_PASSWORD") ?? "devpassword123";
}
