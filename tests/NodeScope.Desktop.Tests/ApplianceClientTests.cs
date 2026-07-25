using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
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

    [Fact]
    public async Task Properties_maps_the_direct_envelope_list_for_the_building_picker()
    {
        _respond = _ => Envelope(
            HttpStatusCode.OK,
            """
            {"success":true,"data":[{"id":"b1","parentId":"s1","type":"BUILDING","name":"HQ","code":"01"}],"timestamp":"t"}
            """);

        var properties = await _client.GetPropertiesAsync(
            "tok-bim",
            TestContext.Current.CancellationToken);

        var building = Assert.Single(properties);
        Assert.Equal(new PropertySummary("b1", "s1", "BUILDING", "HQ", "01"), building);
        Assert.Equal(
            "https://host.example/sub/api/v1/properties",
            _lastRequest!.RequestUri!.AbsoluteUri);
        Assert.Equal("Bearer tok-bim", _lastRequest.Headers.Authorization!.ToString());
    }

    [Fact]
    public async Task Active_geometry_returns_the_exact_raw_wexbim_body()
    {
        var expected = new byte[] { 0x95, 0x57, 0x9c, 0x05, 0x04 };
        _respond = _ =>
        {
            var content = new ByteArrayContent(expected);
            content.Headers.ContentType = new MediaTypeHeaderValue("application/vnd.xbim.wexbim");
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = content };
        };

        var geometry = await _client.GetActiveModelGeometryAsync(
            "tok-bim",
            "building/with slash",
            TestContext.Current.CancellationToken);

        Assert.Equal(expected, geometry);
        Assert.Equal(
            "https://host.example/sub/api/v1/buildings/building%2Fwith%20slash/model/active/geometry",
            _lastRequest!.RequestUri!.AbsoluteUri);
    }

    [Fact]
    public async Task Active_geometry_rejects_an_oversized_content_length_before_buffering()
    {
        _respond = _ =>
        {
            var content = new ByteArrayContent([1]);
            content.Headers.ContentType = new MediaTypeHeaderValue("application/vnd.xbim.wexbim");
            content.Headers.ContentLength = 209_715_201;
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = content };
        };

        var error = await Assert.ThrowsAsync<ApplianceApiException>(
            () => _client.GetActiveModelGeometryAsync(
                "tok-bim",
                "b1",
                TestContext.Current.CancellationToken));

        Assert.Equal("MODEL_GEOMETRY_TOO_LARGE", error.Code);
    }

    [Fact]
    public async Task Active_geometry_rejects_a_successful_html_response()
    {
        _respond = _ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("<html>proxy</html>", Encoding.UTF8, "text/html"),
        };

        var error = await Assert.ThrowsAsync<ApplianceApiException>(
            () => _client.GetActiveModelGeometryAsync(
                "tok-bim",
                "b1",
                TestContext.Current.CancellationToken));

        Assert.Equal(ApplianceApiException.ProtocolErrorCode, error.Code);
        Assert.Contains("content type", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Geometry_upload_rejects_a_receipt_for_different_bytes()
    {
        _respond = _ => Envelope(
            HttpStatusCode.OK,
            """{"success":true,"data":{"versionId":"v1","format":"WEXBIM","contentHash":"wrong","sizeBytes":4},"timestamp":"t"}""");

        var error = await Assert.ThrowsAsync<ApplianceApiException>(
            () => _client.UploadModelGeometryAsync(
                "tok",
                "b1",
                "v1",
                [1, 2, 3, 4],
                TestContext.Current.CancellationToken));

        Assert.Equal(ApplianceApiException.ProtocolErrorCode, error.Code);
        Assert.Contains("receipt", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Native_import_uses_inactive_ifc_geometry_activation_and_cleanup_wires()
    {
        _respond = _ => Envelope(
            HttpStatusCode.Created,
            """
            {"success":true,"data":{"id":"v1","buildingModelId":"m1","versionNumber":2,"fileName":"HQ model.ifc","contentHash":"abc","sizeBytes":3,"units":null,"uploadedByMemberId":"mem1","createdAt":"2026-07-25T12:00:00Z"},"timestamp":"t"}
            """);
        using var ifc = new MemoryStream("IFC"u8.ToArray());
        var version = await _client.UploadModelVersionAsync(
            "tok",
            "building/1",
            "HQ model.ifc",
            ifc,
            TestContext.Current.CancellationToken);

        Assert.Equal("v1", version.Id);
        Assert.Equal(HttpMethod.Post, _lastRequest!.Method);
        Assert.Equal(
            "https://host.example/sub/api/v1/buildings/building%2F1/model/versions?fileName=HQ%20model.ifc&activate=false",
            _lastRequest.RequestUri!.AbsoluteUri);
        Assert.Equal("application/octet-stream", _lastRequest.Content!.Headers.ContentType!.MediaType);
        Assert.Equal("IFC", _lastRequestBody);

        var geometry = new byte[] { 1, 2, 3, 4 };
        var geometryHash = Convert.ToHexStringLower(SHA256.HashData(geometry));
        _respond = _ => Envelope(
            HttpStatusCode.OK,
            $$"""{"success":true,"data":{"versionId":"v1","format":"WEXBIM","contentHash":"{{geometryHash}}","sizeBytes":4},"timestamp":"t"}""");
        await _client.UploadModelGeometryAsync(
            "tok",
            "building/1",
            "v1",
            geometry,
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpMethod.Put, _lastRequest!.Method);
        Assert.EndsWith(
            "/api/v1/buildings/building%2F1/model/versions/v1/geometry",
            _lastRequest.RequestUri!.AbsoluteUri,
            StringComparison.Ordinal);
        Assert.Equal(
            "application/vnd.xbim.wexbim",
            _lastRequest.Content!.Headers.ContentType!.MediaType);

        var metadata =
            new[]
            {
                new BuildingModelElementMetadata(
                    17,
                    "0ABCDEFGHIJKLMNOPQRSTU",
                    "IfcWall",
                    "North wall"),
            };
        _respond = _ =>
        {
            var body = Encoding.UTF8.GetBytes(_lastRequestBody!);
            var hash = Convert.ToHexStringLower(SHA256.HashData(body));
            return Envelope(
                HttpStatusCode.OK,
                $$"""
                {"success":true,"data":{"versionId":"v1","formatVersion":1,"contentHash":"{{hash}}","sizeBytes":{{body.Length}},"elementCount":1},"timestamp":"t"}
                """);
        };
        await _client.UploadModelMetadataAsync(
            "tok",
            "building/1",
            "v1",
            metadata,
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpMethod.Put, _lastRequest!.Method);
        Assert.EndsWith(
            "/api/v1/buildings/building%2F1/model/versions/v1/metadata",
            _lastRequest.RequestUri!.AbsoluteUri,
            StringComparison.Ordinal);
        Assert.Contains("\"formatVersion\":1", _lastRequestBody, StringComparison.Ordinal);
        Assert.Contains("\"productLabel\":17", _lastRequestBody, StringComparison.Ordinal);
        Assert.Contains(
            "\"globalId\":\"0ABCDEFGHIJKLMNOPQRSTU\"",
            _lastRequestBody,
            StringComparison.Ordinal);

        _respond = _ => Envelope(
            HttpStatusCode.OK,
            """{"success":true,"data":{"id":"m1","propertyId":"building/1","name":"HQ","activeVersionId":"v1","version":3},"timestamp":"t"}""");
        var model = await _client.ActivateModelVersionAsync(
            "tok",
            "building/1",
            "v1",
            TestContext.Current.CancellationToken);

        Assert.Equal("v1", model.ActiveVersionId);
        Assert.Equal(HttpMethod.Put, _lastRequest!.Method);
        Assert.EndsWith(
            "/api/v1/buildings/building%2F1/model/active",
            _lastRequest.RequestUri!.AbsoluteUri,
            StringComparison.Ordinal);
        Assert.Contains("\"versionId\":\"v1\"", _lastRequestBody, StringComparison.Ordinal);

        _respond = _ => new HttpResponseMessage(HttpStatusCode.NoContent);
        await _client.DeleteModelVersionAsync(
            "tok",
            "building/1",
            "v1",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpMethod.Delete, _lastRequest!.Method);
        Assert.EndsWith(
            "/api/v1/buildings/building%2F1/model/versions/v1",
            _lastRequest.RequestUri!.AbsoluteUri,
            StringComparison.Ordinal);
    }

    [Fact]
    public async Task Active_metadata_maps_the_portable_IFC_identity_index()
    {
        _respond = _ => Envelope(
            HttpStatusCode.OK,
            """
            {"success":true,"data":{"versionId":"v1","formatVersion":1,"elements":[{"productLabel":17,"globalId":"0ABCDEFGHIJKLMNOPQRSTU","typeName":"IfcWall","name":"North wall"}]},"timestamp":"t"}
            """);

        var metadata = await _client.GetActiveModelMetadataAsync(
            "tok",
            "building/1",
            TestContext.Current.CancellationToken);

        Assert.Equal("v1", metadata.VersionId);
        var element = Assert.Single(metadata.Elements);
        Assert.Equal(17, element.ProductLabel);
        Assert.Equal("IfcWall", element.TypeName);
        Assert.EndsWith(
            "/api/v1/buildings/building%2F1/model/active/metadata",
            _lastRequest!.RequestUri!.AbsoluteUri,
            StringComparison.Ordinal);
    }

    [Fact]
    public async Task Bim_operations_use_spatial_monitoring_and_Bcf_contracts()
    {
        _respond = request => request.RequestUri!.AbsolutePath.EndsWith(
            "/api/v1/access/me",
            StringComparison.Ordinal)
            ? Envelope(
                HttpStatusCode.OK,
                """{"success":true,"data":{"role":"OWNER","assignedRootPropertyIds":[],"unscoped":true},"timestamp":"t"}""")
            : Envelope(
                HttpStatusCode.OK,
                """
                {"success":true,"data":[{"id":"d1","networkId":"n1","propertyId":"b1","roleCode":null,"userId":null,"name":"Core","category":"SWITCH","latitude":null,"longitude":null,"floor":1,"floorLabel":"Level 1","x":1.0,"y":2.0,"z":3.0,"ifcGlobalId":null,"ipAddress":"10.0.0.1","macAddress":null,"notes":null,"version":1,"createdAt":"2026-07-25T12:00:00Z","updatedAt":"2026-07-25T12:00:00Z"}],"timestamp":"t"}
                """);

        var access = await _client.GetAccessSummaryAsync(
            "tok",
            TestContext.Current.CancellationToken);
        var devices = await _client.GetBuildingDevicesAsync(
            "tok",
            "b/1",
            TestContext.Current.CancellationToken);

        Assert.True(access.CanConfigure);
        Assert.True(Assert.Single(devices).IsPlaced);
        Assert.Contains(
            "buildingPropertyId=b%2F1",
            _lastRequest!.RequestUri!.Query,
            StringComparison.Ordinal);

        _respond = _ => Envelope(
            HttpStatusCode.OK,
            """
            {"success":true,"data":{"id":"d1","networkId":"n1","propertyId":"b1","roleCode":null,"userId":null,"name":"Core","category":"SWITCH","latitude":null,"longitude":null,"floor":1,"floorLabel":"Level 1","x":4.0,"y":5.0,"z":6.0,"ifcGlobalId":null,"ipAddress":"10.0.0.1","macAddress":null,"notes":null,"version":2,"createdAt":"2026-07-25T12:00:00Z","updatedAt":"2026-07-25T12:01:00Z"},"timestamp":"t"}
            """);
        var positioned = await _client.SetDevicePositionAsync(
            "tok",
            "d/1",
            4,
            5,
            6,
            TestContext.Current.CancellationToken);

        Assert.Equal(4, positioned.X);
        Assert.EndsWith(
            "/api/v1/devices/d%2F1/position",
            _lastRequest!.RequestUri!.AbsoluteUri,
            StringComparison.Ordinal);
        Assert.Contains("\"x\":4", _lastRequestBody, StringComparison.Ordinal);

        _respond = _ => Envelope(
            HttpStatusCode.OK,
            """
            {"success":true,"data":[{"deviceId":"d1","state":"UP","latencyMs":8.5,"lastCheckAt":"2026-07-25T12:00:00Z","lastOkAt":"2026-07-25T12:00:00Z","lastChangeAt":"2026-07-25T11:00:00Z"}],"timestamp":"t"}
            """);
        var statuses = await _client.GetBuildingDeviceStatusAsync(
            "tok",
            "b1",
            TestContext.Current.CancellationToken);

        Assert.Equal("UP", Assert.Single(statuses).State);

        _respond = _ => Envelope(
            HttpStatusCode.Created,
            """
            {"success":true,"data":{"id":"topic-1","propertyId":"b1","guid":"guid-1","title":"Inspect wall","topicType":"Issue","topicStatus":"OPEN","priority":"HIGH","version":1,"commentCount":0,"comments":[],"viewpoints":[]},"timestamp":"t"}
            """);
        var topic = await _client.CreateBcfTopicAsync(
            "tok",
            "b1",
            new CreateBcfTopic(
                "Inspect wall",
                "Issue",
                "OPEN",
                "HIGH",
                [],
                null,
                null,
                null,
                []),
            TestContext.Current.CancellationToken);

        Assert.Equal("topic-1", topic.Id);
        Assert.EndsWith(
            "/api/v1/buildings/b1/bcf/topics",
            _lastRequest!.RequestUri!.AbsoluteUri,
            StringComparison.Ordinal);
        Assert.Contains("\"title\":\"Inspect wall\"", _lastRequestBody, StringComparison.Ordinal);
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
