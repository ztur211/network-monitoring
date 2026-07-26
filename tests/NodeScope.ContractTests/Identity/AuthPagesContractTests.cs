using System.Text;

namespace NodeScope.ContractTests.Identity;

/// <summary>
/// Contract for the host-served browser auth page (step 6: the SPA is gone, the host
/// itself faces the system browser). <c>/login</c> is the desktop-auth flow's bounce
/// target, so it must serve a self-contained HTML page that signs in against the
/// same-origin auth endpoints; <c>/</c> and the SPA-era <c>/register</c> route land on
/// the same page. Raw wire - no envelope, no auth.
/// </summary>
[Collection(ContractSuite.Name)]
public class AuthPagesContractTests
{
    private readonly ApiClient _api;

    public AuthPagesContractTests(ContractApiFixture fixture) => _api = fixture.Api;

    [Fact]
    public async Task Login_serves_the_self_contained_auth_page_uncached()
    {
        // The client's base address is {BASE_URL}/api/; the page lives at the root.
        var response = await _api.GetRawAsync("../login");

        Assert.Equal(HttpStatusCode.OK, response.Status);
        Assert.Contains("text/html", response.Header("Content-Type"), StringComparison.Ordinal);
        Assert.Contains("no-store", response.Header("Cache-Control"), StringComparison.Ordinal);

        var html = Encoding.UTF8.GetString([.. response.Body]);
        // The page must be able to run the whole flow: both auth endpoints, the
        // desktop returnTo validation, and no external asset to fetch.
        Assert.Contains("/api/auth/sign-in/email", html, StringComparison.Ordinal);
        Assert.Contains("/api/auth/sign-up/email", html, StringComparison.Ordinal);
        Assert.Contains("/api/v1/desktop-auth/authorize", html, StringComparison.Ordinal);
        Assert.DoesNotContain("src=\"http", html, StringComparison.Ordinal);
        Assert.DoesNotContain("href=\"http", html, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("../")]
    [InlineData("../register")]
    public async Task The_root_and_the_spa_era_register_route_land_on_the_page(string path)
    {
        var response = await _api.GetRawAsync(path);

        Assert.Equal(HttpStatusCode.OK, response.Status);
        Assert.Contains("text/html", response.Header("Content-Type"), StringComparison.Ordinal);
        Assert.Contains(
            "auth-form", Encoding.UTF8.GetString([.. response.Body]), StringComparison.Ordinal);
    }
}
