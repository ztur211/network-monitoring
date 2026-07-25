using System.Net;
using System.Text;
using NodeScope.Desktop.Api;
using Xunit;

namespace NodeScope.Desktop.Tests;

public sealed class ApplianceClientTests : IDisposable
{
    private HttpRequestMessage? _lastRequest;
    private string? _lastRequestBody;
    private Func<HttpRequestMessage, HttpResponseMessage> _respond =
        _ => Envelope(HttpStatusCode.OK, """{"success":true,"data":null,"timestamp":"t"}""");

    private readonly StubHandler _handler;
    private readonly HttpClient _http;
    private readonly ApplianceClient _client;

    public ApplianceClientTests()
    {
        _handler = new StubHandler(this);
        _http = new HttpClient(_handler) { BaseAddress = new Uri("https://host.example/sub/") };
        _client = new ApplianceClient(_http, new Uri("https://host.example/sub/"));
    }

    public void Dispose()
    {
        _client.Dispose();
        _http.Dispose();
        _handler.Dispose();
    }

    [Fact]
    public async Task Exchange_posts_the_snake_case_body_and_returns_the_token()
    {
        _respond = _ => Envelope(HttpStatusCode.Created,
            """{"success":true,"data":{"token":"tok-123"},"timestamp":"t"}""");

        var token = await _client.ExchangeDesktopCodeAsync("the-code", "the-verifier", CancellationToken.None);

        Assert.Equal("tok-123", token);
        // The base URL's own path segment must survive relative composition.
        Assert.Equal("https://host.example/sub/api/v1/desktop-auth/token", _lastRequest!.RequestUri!.AbsoluteUri);
        Assert.Contains("\"code\":\"the-code\"", _lastRequestBody, StringComparison.Ordinal);
        Assert.Contains("\"code_verifier\":\"the-verifier\"", _lastRequestBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task An_error_envelope_becomes_a_typed_exception()
    {
        _respond = _ => Envelope(HttpStatusCode.BadRequest,
            """{"success":false,"error":{"code":"DAUTH_002","message":"CODE_INVALID_OR_EXPIRED"},"timestamp":"t"}""");

        var failure = await Assert.ThrowsAsync<ApplianceApiException>(
            () => _client.ExchangeDesktopCodeAsync("x", "y", CancellationToken.None));

        Assert.Equal("DAUTH_002", failure.Code);
        Assert.Equal(400, failure.Status);
        Assert.Equal("CODE_INVALID_OR_EXPIRED", failure.Message);
    }

    [Fact]
    public async Task A_non_envelope_body_becomes_a_protocol_error()
    {
        _respond = _ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("<!doctype html><html>SPA</html>", Encoding.UTF8, "text/html"),
        };

        var failure = await Assert.ThrowsAsync<ApplianceApiException>(
            () => _client.GetCurrentUserAsync("tok", CancellationToken.None));

        Assert.Equal(ApplianceApiException.ProtocolErrorCode, failure.Code);
        Assert.Equal(200, failure.Status);
    }

    [Fact]
    public async Task Users_me_sends_the_bearer_and_maps_the_camel_case_user()
    {
        _respond = _ => Envelope(HttpStatusCode.OK,
            """{"success":true,"data":{"id":"u1","email":"o@a.test","name":"Owner","tier":"FREE"},"timestamp":"t"}""");

        var user = await _client.GetCurrentUserAsync("tok-9", CancellationToken.None);

        Assert.Equal(new CurrentUser("u1", "o@a.test", "Owner"), user);
        Assert.Equal("Bearer tok-9", _lastRequest!.Headers.Authorization!.ToString());
    }

    [Fact]
    public async Task Revoke_accepts_the_bare_204()
    {
        _respond = _ => new HttpResponseMessage(HttpStatusCode.NoContent);

        await _client.RevokeAsync("tok-9", CancellationToken.None);

        Assert.Equal("https://host.example/sub/api/v1/desktop-auth/revoke", _lastRequest!.RequestUri!.AbsoluteUri);
    }

    [Fact]
    public void The_factory_normalizes_a_slashless_base_url()
    {
        using var factory = new ApplianceClientFactory();
        using var created = factory.Create(new Uri("https://host.example/sub"));

        Assert.Equal("https://host.example/sub/", created.BaseUrl.AbsoluteUri);
    }

    private static HttpResponseMessage Envelope(HttpStatusCode status, string json) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    private sealed class StubHandler(ApplianceClientTests owner) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            owner._lastRequest = request;
            owner._lastRequestBody = request.Content is null
                ? null
                : await request.Content.ReadAsStringAsync(cancellationToken);
            return owner._respond(request);
        }
    }
}
