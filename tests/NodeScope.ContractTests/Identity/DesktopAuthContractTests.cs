using System.Security.Cryptography;
using System.Text;

namespace NodeScope.ContractTests.Identity;

/// <summary>
/// Contract for the desktop PKCE flow (v1/desktop-auth). Authorize is a redirect
/// endpoint: a wrong redirect_uri is DAUTH_001, an anonymous browser is bounced to
/// the web login, and a session-holding one is redirected to the app scheme with a
/// one-time code. Exchanging that code with the matching verifier returns the
/// session token as a Bearer credential; a bad code is DAUTH_002, a wrong verifier
/// DAUTH_003 - and the code burns on first use either way. Revoke (authenticated)
/// kills the session. Asserted with redirects NOT followed - the Location header
/// IS the contract.
/// </summary>
[Collection(ContractSuite.Name)]
public sealed class DesktopAuthContractTests : IDisposable
{
    private const string RedirectUri = "nodescope://auth/callback";

    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;
    private readonly SocketsHttpHandler _noRedirectHandler;
    private readonly HttpClient _noRedirect;

    public DesktopAuthContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
        _noRedirectHandler = new SocketsHttpHandler { UseCookies = false, AllowAutoRedirect = false };
        _noRedirect = new HttpClient(_noRedirectHandler, disposeHandler: false)
        {
            BaseAddress = new Uri(TestConfig.BaseUrl + "/api/"),
        };
    }

    public void Dispose()
    {
        _noRedirect.Dispose();
        _noRedirectHandler.Dispose();
    }

    [Fact]
    public async Task Authorize_with_a_wrong_redirect_uri_is_400_DAUTH_001()
    {
        var response = await _noRedirect.GetAsync(new Uri(
            "v1/desktop-auth/authorize?code_challenge=x&state=s&redirect_uri=https%3A%2F%2Fevil.example",
            UriKind.Relative));
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("DAUTH_001", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Authorize_without_a_session_redirects_to_the_web_login()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(
            $"v1/desktop-auth/authorize?code_challenge=x&state=s&redirect_uri={Uri.EscapeDataString(RedirectUri)}",
            UriKind.Relative));
        var response = await _noRedirect.SendAsync(request);

        Assert.Equal(HttpStatusCode.Found, response.StatusCode);
        var location = response.Headers.Location?.ToString() ?? string.Empty;
        Assert.Contains("/login?returnTo=", location, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_full_PKCE_flow_yields_a_working_Bearer_token_and_revoke_kills_it()
    {
        var user = await AuthWorkflow.SignUpAsync(_api);
        var (verifier, challenge) = NewPkcePair();

        var code = await AuthorizeAsync(user, challenge, state: "xyzzy");

        var exchange = await _api.PostAsync(
            "v1/desktop-auth/token",
            new { code, code_verifier = verifier });
        Assert.Equal(HttpStatusCode.Created, exchange.Status);
        var token = exchange.Data.GetProperty("token").GetString();
        Assert.False(string.IsNullOrEmpty(token));

        // The exchanged token IS a session credential.
        var me = await _api.GetAsync("v1/users/me", Auth.Bearer(token!));
        Assert.Equal(HttpStatusCode.OK, me.Status);
        Assert.Equal(user.UserId, me.Data.GetProperty("id").GetString());

        var revoke = await _api.PostAsync("v1/desktop-auth/revoke", auth: Auth.Bearer(token!));
        Assert.Equal(HttpStatusCode.NoContent, revoke.Status);

        var afterRevoke = await _api.GetAsync("v1/users/me", Auth.Bearer(token!));
        Assert.Equal(HttpStatusCode.Unauthorized, afterRevoke.Status);
        Assert.Equal("AUTH_002", afterRevoke.ErrorCode);
    }

    [Fact]
    public async Task Exchange_with_a_bad_code_is_DAUTH_002_and_a_wrong_verifier_burns_the_code_DAUTH_003()
    {
        var badCode = await _api.PostAsync(
            "v1/desktop-auth/token",
            new { code = "no-such-code", code_verifier = "whatever" });
        Assert.Equal(HttpStatusCode.BadRequest, badCode.Status);
        Assert.Equal("DAUTH_002", badCode.ErrorCode);

        var user = await AuthWorkflow.SignUpAsync(_api);
        var (_, challenge) = NewPkcePair();
        var code = await AuthorizeAsync(user, challenge, state: "s");

        var wrongVerifier = await _api.PostAsync(
            "v1/desktop-auth/token",
            new { code, code_verifier = "not-the-right-verifier" });
        Assert.Equal(HttpStatusCode.BadRequest, wrongVerifier.Status);
        Assert.Equal("DAUTH_003", wrongVerifier.ErrorCode);

        // The failed attempt consumed the code - a retry cannot brute-force it.
        var retry = await _api.PostAsync(
            "v1/desktop-auth/token",
            new { code, code_verifier = "another-guess" });
        Assert.Equal(HttpStatusCode.BadRequest, retry.Status);
        Assert.Equal("DAUTH_002", retry.ErrorCode);
    }

    /// <summary>Runs the authorize redirect with a session and returns the one-time code.</summary>
    private async Task<string> AuthorizeAsync(UserSession user, string challenge, string state)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(
            $"v1/desktop-auth/authorize?code_challenge={Uri.EscapeDataString(challenge)}" +
            $"&state={Uri.EscapeDataString(state)}&redirect_uri={Uri.EscapeDataString(RedirectUri)}",
            UriKind.Relative));
        request.Headers.Add("Cookie", user.Cookie);
        var response = await _noRedirect.SendAsync(request);

        Assert.Equal(HttpStatusCode.Found, response.StatusCode);
        var location = response.Headers.Location?.ToString() ?? string.Empty;
        Assert.StartsWith(RedirectUri + "?", location, StringComparison.Ordinal);
        Assert.Contains($"state={Uri.EscapeDataString(state)}", location, StringComparison.Ordinal);

        var query = System.Web.HttpUtility.ParseQueryString(new Uri(location).Query);
        return query["code"] ?? throw new InvalidOperationException("authorize redirect carried no code");
    }

    private static (string Verifier, string Challenge) NewPkcePair()
    {
        var verifier = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
        var challenge = Base64Url(SHA256.HashData(Encoding.UTF8.GetBytes(verifier)));
        return (verifier, challenge);
    }

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
