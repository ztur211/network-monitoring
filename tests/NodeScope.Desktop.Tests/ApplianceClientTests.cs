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
    public async Task Sign_in_posts_the_credentials_and_returns_the_enveloped_token()
    {
        _respond = _ => Envelope(HttpStatusCode.OK,
            """{"success":true,"data":{"token":"tok-123"},"timestamp":"t"}""");

        var token = await _client.SignInAsync("o@a.test", "pw-1", CancellationToken.None);

        Assert.Equal("tok-123", token);
        // The base URL's own path segment must survive relative composition.
        Assert.Equal("https://host.example/sub/api/v1/auth/sign-in", _lastRequest!.RequestUri!.AbsoluteUri);
        Assert.Contains("\"email\":\"o@a.test\"", _lastRequestBody, StringComparison.Ordinal);
        Assert.Contains("\"password\":\"pw-1\"", _lastRequestBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Sign_up_posts_the_name_too_and_returns_the_first_session_token()
    {
        _respond = _ => Envelope(HttpStatusCode.Created,
            """{"success":true,"data":{"token":"tok-124"},"timestamp":"t"}""");

        var token = await _client.SignUpAsync("Owner", "o@a.test", "pw-1", CancellationToken.None);

        Assert.Equal("tok-124", token);
        Assert.Equal("https://host.example/sub/api/v1/auth/sign-up", _lastRequest!.RequestUri!.AbsoluteUri);
        Assert.Contains("\"name\":\"Owner\"", _lastRequestBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Rejected_credentials_become_a_typed_exception()
    {
        _respond = _ => Envelope(HttpStatusCode.Unauthorized,
            """{"success":false,"error":{"code":"AUTH_001","message":"INVALID_CREDENTIALS"},"timestamp":"t"}""");

        var failure = await Assert.ThrowsAsync<ApplianceApiException>(
            () => _client.SignInAsync("o@a.test", "wrong", CancellationToken.None));

        Assert.Equal("AUTH_001", failure.Code);
        Assert.Equal(401, failure.Status);
        Assert.Equal("INVALID_CREDENTIALS", failure.Message);
    }

    [Fact]
    public async Task An_error_envelope_becomes_a_typed_exception()
    {
        _respond = _ => Envelope(HttpStatusCode.NotFound,
            """{"success":false,"error":{"code":"GEN_002","message":"NOT_FOUND"},"timestamp":"t"}""");

        var failure = await Assert.ThrowsAsync<ApplianceApiException>(
            () => _client.GetCurrentUserAsync("tok", CancellationToken.None));

        Assert.Equal("GEN_002", failure.Code);
        Assert.Equal(404, failure.Status);
        Assert.Equal("NOT_FOUND", failure.Message);
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
    public async Task Sign_out_sends_the_bearer_and_accepts_the_bare_204()
    {
        _respond = _ => new HttpResponseMessage(HttpStatusCode.NoContent);

        await _client.SignOutAsync("tok-9", CancellationToken.None);

        Assert.Equal("https://host.example/sub/api/v1/auth/sign-out", _lastRequest!.RequestUri!.AbsoluteUri);
        Assert.Equal("Bearer tok-9", _lastRequest.Headers.Authorization!.ToString());
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

    [Fact]
    public async Task Device_inventory_parses_the_items_total_envelope()
    {
        _respond = _ => Envelope(
            HttpStatusCode.OK,
            """
            {"success":true,"data":{"items":[{"id":"d1","networkId":"n1","propertyId":"p1","roleCode":null,"userId":"u1","name":"Core Router","category":"ROUTER","latitude":40.7,"longitude":-74.0,"floor":1,"floorLabel":null,"x":null,"y":null,"z":null,"ifcGlobalId":null,"ipAddress":"10.0.0.1","macAddress":null,"notes":null,"version":2,"createdAt":"2026-07-25T12:00:00Z","updatedAt":"2026-07-25T12:00:00Z"}],"total":1},"timestamp":"t"}
            """);

        var page = await _client.GetDeviceInventoryAsync("tok", TestContext.Current.CancellationToken);

        Assert.Equal(1, page.Total);
        var device = Assert.Single(page.Items);
        Assert.Equal("Core Router", device.Name);
        Assert.Equal(2, device.Version);
        Assert.EndsWith("/api/v1/devices", _lastRequest!.RequestUri!.AbsoluteUri, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Device_create_posts_the_camel_case_body_with_network_and_property()
    {
        _respond = _ => Envelope(
            HttpStatusCode.Created,
            """
            {"success":true,"data":{"id":"d9","networkId":"n1","propertyId":"p1","roleCode":null,"userId":"u1","name":"Switch 1","category":"SWITCH","latitude":null,"longitude":null,"floor":null,"floorLabel":null,"x":null,"y":null,"z":null,"ifcGlobalId":null,"ipAddress":null,"macAddress":null,"notes":null,"version":1,"createdAt":"2026-07-25T12:00:00Z","updatedAt":"2026-07-25T12:00:00Z"},"timestamp":"t"}
            """);

        var created = await _client.CreateDeviceAsync(
            "tok",
            new CreateDevice("Switch 1", "SWITCH", "n1", "p1", null, null, null, null, null, null, null),
            TestContext.Current.CancellationToken);

        Assert.Equal("d9", created.Id);
        Assert.Equal(HttpMethod.Post, _lastRequest!.Method);
        Assert.Contains("\"name\":\"Switch 1\"", _lastRequestBody, StringComparison.Ordinal);
        Assert.Contains("\"networkId\":\"n1\"", _lastRequestBody, StringComparison.Ordinal);
        Assert.Contains("\"propertyId\":\"p1\"", _lastRequestBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Device_update_sends_the_shared_changeset_body()
    {
        _respond = _ => Envelope(
            HttpStatusCode.OK,
            """
            {"success":true,"data":{"id":"d1","networkId":"n1","propertyId":"p1","roleCode":null,"userId":"u1","name":"Renamed","category":"ROUTER","latitude":null,"longitude":null,"floor":null,"floorLabel":null,"x":null,"y":null,"z":null,"ifcGlobalId":null,"ipAddress":null,"macAddress":null,"notes":null,"version":3,"createdAt":"2026-07-25T12:00:00Z","updatedAt":"2026-07-25T12:00:00Z"},"timestamp":"t"}
            """);

        var updated = await _client.UpdateDeviceAsync(
            "tok",
            "d1",
            2,
            [FieldChange.Of("name", "Old", "Renamed"), FieldChange.Of("ipAddress", "10.0.0.1", null)],
            TestContext.Current.CancellationToken);

        Assert.Equal(3, updated.Version);
        Assert.Equal(HttpMethod.Patch, _lastRequest!.Method);
        Assert.EndsWith("/api/v1/devices/d1", _lastRequest.RequestUri!.AbsoluteUri, StringComparison.Ordinal);
        Assert.Contains("\"baseVersion\":2", _lastRequestBody, StringComparison.Ordinal);
        Assert.Contains(
            "{\"field\":\"name\",\"oldValue\":\"Old\",\"newValue\":\"Renamed\"}",
            _lastRequestBody,
            StringComparison.Ordinal);
        // A cleared optional rides as an explicit null, never as an absent member.
        Assert.Contains(
            "{\"field\":\"ipAddress\",\"oldValue\":\"10.0.0.1\",\"newValue\":null}",
            _lastRequestBody,
            StringComparison.Ordinal);
    }

    [Fact]
    public async Task Device_delete_accepts_the_ok_null_envelope()
    {
        _respond = _ => Envelope(HttpStatusCode.OK, """{"success":true,"data":null,"timestamp":"t"}""");

        await _client.DeleteDeviceAsync("tok", "d1", TestContext.Current.CancellationToken);

        Assert.Equal(HttpMethod.Delete, _lastRequest!.Method);
        Assert.EndsWith("/api/v1/devices/d1", _lastRequest.RequestUri!.AbsoluteUri, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Name_suggestion_escapes_the_query_and_reads_the_name()
    {
        _respond = _ => Envelope(
            HttpStatusCode.OK, """{"success":true,"data":{"suggestedName":"Router 2"},"timestamp":"t"}""");

        var name = await _client.GetDeviceNameSuggestionAsync(
            "tok", "p 1", "ROUTER", TestContext.Current.CancellationToken);

        Assert.Equal("Router 2", name);
        Assert.EndsWith(
            "/api/v1/devices/name-suggestion?propertyId=p%201&category=ROUTER",
            _lastRequest!.RequestUri!.AbsoluteUri,
            StringComparison.Ordinal);
    }

    [Fact]
    public async Task Circuits_page_carries_the_cursor_and_parses_the_page_shape()
    {
        _respond = _ => Envelope(
            HttpStatusCode.OK,
            """
            {"success":true,"data":{"items":[{"id":"c1","userId":"u1","ispName":"Comcast","circuitId":"X-1","serviceType":"Fiber","bandwidth":1000,"deviceId":null,"notes":null,"version":1,"createdAt":"2026-07-25T12:00:00Z","updatedAt":"2026-07-25T12:00:00Z"}],"nextCursor":"abc+/=","total":51},"timestamp":"t"}
            """);

        var page = await _client.GetCircuitsAsync("tok", 50, "abc+/=", TestContext.Current.CancellationToken);

        Assert.Equal(51, page.Total);
        Assert.Equal("abc+/=", page.NextCursor);
        Assert.Equal("Comcast", Assert.Single(page.Items).IspName);
        Assert.EndsWith(
            "/api/v1/circuits?limit=50&cursor=abc%2B%2F%3D",
            _lastRequest!.RequestUri!.AbsoluteUri,
            StringComparison.Ordinal);
    }

    [Fact]
    public async Task Clients_read_maps_the_nested_summary()
    {
        _respond = _ => Envelope(
            HttpStatusCode.OK,
            """
            {"success":true,"data":{"currentDevice":{"userAgent":"NodeScope-Desktop/1.0","platform":"Linux","metrics":{"bandwidthDown":120.5,"bandwidthUp":20.1,"latency":8,"connectionQuality":"good","timestamp":"2026-07-25T12:00:00Z"}},"agentStatus":{"available":false,"message":"Post-MVP"}},"timestamp":"t"}
            """);

        var summary = await _client.GetClientsAsync("tok", TestContext.Current.CancellationToken);

        Assert.Equal("Linux", summary.CurrentDevice.Platform);
        Assert.Equal(120.5, summary.CurrentDevice.Metrics!.BandwidthDown);
        Assert.False(summary.AgentStatus.Available);
    }

    [Fact]
    public async Task Networks_read_parses_the_bare_array()
    {
        _respond = _ => Envelope(
            HttpStatusCode.OK,
            """
            {"success":true,"data":[{"id":"n1","name":"Home","homeAddress":null,"homeLatitude":null,"homeLongitude":null,"isp":null,"downMbps":null,"upMbps":null,"version":1,"createdAt":"2026-07-25T12:00:00Z","updatedAt":"2026-07-25T12:00:00Z"}],"timestamp":"t"}
            """);

        var networks = await _client.GetNetworksAsync("tok", TestContext.Current.CancellationToken);

        Assert.Equal("n1", Assert.Single(networks).Id);
    }

    [Fact]
    public async Task Update_me_sends_only_the_provided_fields()
    {
        _respond = _ => Envelope(
            HttpStatusCode.OK,
            """{"success":true,"data":{"id":"u1","email":"o@a.test","name":"New Name","tier":"FREE"},"timestamp":"t"}""");

        var user = await _client.UpdateMeAsync("tok", "New Name", null, TestContext.Current.CancellationToken);

        Assert.Equal("New Name", user.Name);
        Assert.Equal(HttpMethod.Patch, _lastRequest!.Method);
        Assert.Equal("""{"name":"New Name"}""", _lastRequestBody);
    }

    [Fact]
    public async Task Set_location_posts_the_address_and_reads_the_coordinates()
    {
        _respond = _ => Envelope(
            HttpStatusCode.OK,
            """{"success":true,"data":{"latitude":40.7128,"longitude":-74.006,"address":"City Hall"},"timestamp":"t"}""");

        var location = await _client.SetHomeLocationAsync(
            "tok", "260 Broadway", TestContext.Current.CancellationToken);

        Assert.Equal(40.7128, location.Latitude);
        Assert.Equal("City Hall", location.Address);
        Assert.Equal("""{"address":"260 Broadway"}""", _lastRequestBody);
    }

    [Fact]
    public async Task Data_sources_unwrap_the_sources_member()
    {
        _respond = _ => Envelope(
            HttpStatusCode.OK,
            """{"success":true,"data":{"sources":[{"type":"browser","connected":false,"lastSeen":null,"message":"inactive"}]},"timestamp":"t"}""");

        var sources = await _client.GetDataSourcesAsync("tok", TestContext.Current.CancellationToken);

        Assert.Equal("browser", Assert.Single(sources).Type);
    }

    [Fact]
    public async Task Enrollment_code_reads_the_created_code()
    {
        _respond = _ => Envelope(
            HttpStatusCode.Created, """{"success":true,"data":{"code":"enroll-1"},"timestamp":"t"}""");

        var code = await _client.CreateAgentEnrollmentCodeAsync("tok", TestContext.Current.CancellationToken);

        Assert.Equal("enroll-1", code);
        Assert.EndsWith(
            "/api/v1/agents/enrollment-code", _lastRequest!.RequestUri!.AbsoluteUri, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Snmp_assign_always_serializes_both_ids_even_when_null()
    {
        _respond = _ => Envelope(
            HttpStatusCode.OK,
            """{"success":true,"data":{"targetType":"device","targetId":"d1","snmpCredentialId":null,"oidProfileId":null},"timestamp":"t"}""");

        var result = await _client.AssignSnmpAsync(
            "tok",
            new SnmpAssignment("device", "d1", null, null),
            TestContext.Current.CancellationToken);

        Assert.Null(result.SnmpCredentialId);
        // Absent members are a validation error server-side; nulls must ride explicitly.
        Assert.Equal(
            """{"targetType":"device","targetId":"d1","snmpCredentialId":null,"oidProfileId":null}""",
            _lastRequestBody);
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
