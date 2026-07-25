using System.Net;
using System.Net.Http.Json;
using NodeScope.Desktop.Auth;
using Xunit;

namespace NodeScope.Desktop.Tests.Fakes;

/// <summary>
/// Plays the demo owner's browser for the live E2Es: web sign-in cookie in,
/// the nodescope:// callback Location out. Everything else in those tests is
/// the real client code against the real appliance.
/// </summary>
internal sealed class SignInBrowser : IBrowserLauncher, IDisposable
{
    private readonly HttpClientHandler _handler = new() { UseCookies = false, AllowAutoRedirect = false };
    private readonly HttpClient _http;
    private string? _cookie;
    private Uri? _authorizeUrl;

    public SignInBrowser(Uri server)
    {
        _http = new HttpClient(_handler, disposeHandler: false) { BaseAddress = server };
    }

    public void Open(Uri url) => _authorizeUrl = url;

    public void Dispose()
    {
        _http.Dispose();
        _handler.Dispose();
    }

    public async Task SignInAsync(string email, string password)
    {
        using var body = JsonContent.Create(new { email, password });
        using var response = await _http.PostAsync(
            new Uri("api/auth/sign-in/email", UriKind.Relative), body);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var setCookie = response.Headers.GetValues("Set-Cookie")
            .First(value => value.StartsWith("better-auth.session_token=", StringComparison.Ordinal));
        _cookie = setCookie[..setCookie.IndexOf(';', StringComparison.Ordinal)];
    }

    public async Task<Uri> CompleteAuthorizeAsync()
    {
        Assert.NotNull(_authorizeUrl);
        using var request = new HttpRequestMessage(HttpMethod.Get, _authorizeUrl);
        request.Headers.Add("Cookie", _cookie);
        using var response = await _http.SendAsync(request);

        Assert.Equal(HttpStatusCode.Found, response.StatusCode);
        var location = response.Headers.Location;
        Assert.NotNull(location);
        Assert.StartsWith("nodescope://auth/callback?", location.AbsoluteUri, StringComparison.Ordinal);
        return location;
    }
}
