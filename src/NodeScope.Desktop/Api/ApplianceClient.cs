using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace NodeScope.Desktop.Api;

/// <summary>
/// Speaks the appliance's Node-era envelope: <c>{ success, data, timestamp }</c> on
/// success, <c>{ success: false, error: { code, message } }</c> on failure. Anything
/// else (SPA HTML from a wrong URL, a proxy error page) becomes an
/// <see cref="ApplianceApiException"/> with <see cref="ApplianceApiException.ProtocolErrorCode"/>.
/// </summary>
internal sealed class ApplianceClient(HttpClient http, Uri baseUrl) : IApplianceClient
{
    private const int MaxModelGeometryBytes = 209_715_200;
    private const string WexBimMediaType = "application/vnd.xbim.wexbim";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public Uri BaseUrl { get; } = baseUrl;

    public void Dispose() => http.Dispose();

    public async Task<string> ExchangeDesktopCodeAsync(
        string code, string codeVerifier, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri("api/v1/desktop-auth/token", UriKind.Relative))
        {
            Content = JsonContent.Create(new ExchangeRequest(code, codeVerifier), options: Json),
        };
        using var response = await http.SendAsync(request, cancellationToken);
        var data = await ReadEnvelopeDataAsync(response, cancellationToken);

        return data.TryGetProperty("token", out var token) && token.GetString() is { Length: > 0 } value
            ? value
            : throw new ApplianceApiException(
                ApplianceApiException.ProtocolErrorCode, "The token exchange response carried no token.", (int)response.StatusCode);
    }

    public async Task<CurrentUser> GetCurrentUserAsync(string bearerToken, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri("api/v1/users/me", UriKind.Relative));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        using var response = await http.SendAsync(request, cancellationToken);
        var data = await ReadEnvelopeDataAsync(response, cancellationToken);

        return data.Deserialize<CurrentUser>(Json)
            ?? throw new ApplianceApiException(
                ApplianceApiException.ProtocolErrorCode, "The users/me response carried no user.", (int)response.StatusCode);
    }

    public async Task RevokeAsync(string bearerToken, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri("api/v1/desktop-auth/revoke", UriKind.Relative));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        using var response = await http.SendAsync(request, cancellationToken);
        if (response.StatusCode == HttpStatusCode.NoContent)
        {
            return;
        }

        await ReadEnvelopeDataAsync(response, cancellationToken);
    }

    public async Task<bool> ProbeTilesAsync(CancellationToken cancellationToken)
    {
        // Plain reachability, no envelope: the tile server speaks raw HTTP behind /tiles.
        using var response = await http.GetAsync(
            new Uri("tiles/styles/liberty/style.json", UriKind.Relative),
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        return response.IsSuccessStatusCode;
    }

    public Task<IReadOnlyList<MapDevice>> GetDevicesAsync(string bearerToken, CancellationToken cancellationToken) =>
        GetItemsAsync<MapDevice>("api/v1/devices", bearerToken, cancellationToken);

    public Task<IReadOnlyList<MapDevice>> GetMapDevicesAsync(
        string bearerToken, MapBbox bbox, int? floor, CancellationToken cancellationToken)
    {
        var query = $"api/v1/map/devices?bbox={Uri.EscapeDataString(bbox.ToString())}";
        if (floor is { } f)
        {
            query += $"&floor={f}";
        }

        return GetItemsAsync<MapDevice>(query, bearerToken, cancellationToken);
    }

    public Task<IReadOnlyList<MapFiberRun>> GetMapFiberRunsAsync(
        string bearerToken, MapBbox bbox, CancellationToken cancellationToken) =>
        GetItemsAsync<MapFiberRun>(
            $"api/v1/map/fiber-runs?bbox={Uri.EscapeDataString(bbox.ToString())}", bearerToken, cancellationToken);

    public async Task<JsonElement?> GetPreferencesAsync(string bearerToken, CancellationToken cancellationToken)
    {
        using var request = AuthorizedGet("api/v1/users/me/preferences", bearerToken);
        using var response = await http.SendAsync(request, cancellationToken);
        var data = await ReadEnvelopeDataAsync(response, cancellationToken);

        return data.ValueKind == JsonValueKind.Object
            && data.TryGetProperty("preferences", out var preferences)
            && preferences.ValueKind == JsonValueKind.Object
            ? preferences.Clone()
            : null;
    }

    public async Task PutPreferencesAsync(
        string bearerToken, JsonElement preferences, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Put, new Uri("api/v1/users/me/preferences", UriKind.Relative))
        {
            Content = JsonContent.Create(preferences, options: Json),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        using var response = await http.SendAsync(request, cancellationToken);
        await ReadEnvelopeDataAsync(response, cancellationToken);
    }

    public Task<IReadOnlyList<PropertySummary>> GetPropertiesAsync(
        string bearerToken,
        CancellationToken cancellationToken) =>
        GetDataListAsync<PropertySummary>("api/v1/properties", bearerToken, cancellationToken);

    public Task<BuildingModelSummary> GetBuildingModelAsync(
        string bearerToken,
        string propertyId,
        CancellationToken cancellationToken) =>
        GetDataAsync<BuildingModelSummary>(
            $"api/v1/buildings/{Uri.EscapeDataString(propertyId)}/model",
            bearerToken,
            cancellationToken);

    public async Task<byte[]> GetActiveModelGeometryAsync(
        string bearerToken,
        string propertyId,
        CancellationToken cancellationToken)
    {
        var relativeUrl =
            $"api/v1/buildings/{Uri.EscapeDataString(propertyId)}/model/active/geometry";
        using var request = AuthorizedGet(relativeUrl, bearerToken);
        using var response = await http.SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            _ = await ReadEnvelopeDataAsync(response, cancellationToken);
            throw new ApplianceApiException(
                ApplianceApiException.ProtocolErrorCode,
                $"The {relativeUrl} request failed without an error envelope.",
                (int)response.StatusCode);
        }

        var mediaType = response.Content.Headers.ContentType?.MediaType;
        if (!string.Equals(mediaType, WexBimMediaType, StringComparison.OrdinalIgnoreCase)
            && !string.Equals(mediaType, "application/octet-stream", StringComparison.OrdinalIgnoreCase))
        {
            throw new ApplianceApiException(
                ApplianceApiException.ProtocolErrorCode,
                $"The active model geometry response has unexpected content type '{mediaType ?? "(none)"}'.",
                (int)response.StatusCode);
        }

        if (response.Content.Headers.ContentLength is > MaxModelGeometryBytes)
        {
            throw ModelGeometryTooLarge((int)response.StatusCode);
        }

        await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var destination = response.Content.Headers.ContentLength is > 0 and <= MaxModelGeometryBytes
            ? new MemoryStream((int)response.Content.Headers.ContentLength.Value)
            : new MemoryStream();
        var buffer = new byte[81920];
        while (true)
        {
            var read = await source.ReadAsync(buffer, cancellationToken);
            if (read == 0)
            {
                return destination.ToArray();
            }

            if (destination.Length > MaxModelGeometryBytes - read)
            {
                throw ModelGeometryTooLarge((int)response.StatusCode);
            }

            await destination.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
        }
    }

    public Task<BuildingModelMetadataSummary> GetActiveModelMetadataAsync(
        string bearerToken,
        string propertyId,
        CancellationToken cancellationToken) =>
        GetDataAsync<BuildingModelMetadataSummary>(
            $"api/v1/buildings/{Uri.EscapeDataString(propertyId)}/model/active/metadata",
            bearerToken,
            cancellationToken);

    public async Task<BuildingModelVersionSummary> UploadModelVersionAsync(
        string bearerToken,
        string propertyId,
        string fileName,
        Stream content,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(content);
        var relativeUrl =
            $"api/v1/buildings/{Uri.EscapeDataString(propertyId)}/model/versions"
            + $"?fileName={Uri.EscapeDataString(fileName)}&activate=false";
        using var request = AuthorizedStreamRequest(
            HttpMethod.Post,
            relativeUrl,
            bearerToken,
            content,
            "application/octet-stream");
        using var response = await http.SendAsync(request, cancellationToken);
        var data = await ReadEnvelopeDataAsync(response, cancellationToken);
        return data.Deserialize<BuildingModelVersionSummary>(Json)
            ?? throw new ApplianceApiException(
                ApplianceApiException.ProtocolErrorCode,
                "The model upload response carried no version.",
                (int)response.StatusCode);
    }

    public async Task UploadModelGeometryAsync(
        string bearerToken,
        string propertyId,
        string versionId,
        byte[] content,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(content);
        var relativeUrl =
            $"api/v1/buildings/{Uri.EscapeDataString(propertyId)}/model/versions/"
            + $"{Uri.EscapeDataString(versionId)}/geometry";
        using var contentStream = new MemoryStream(content, writable: false);
        using var request = AuthorizedStreamRequest(
            HttpMethod.Put,
            relativeUrl,
            bearerToken,
            contentStream,
            WexBimMediaType);
        using var response = await http.SendAsync(request, cancellationToken);
        var data = await ReadEnvelopeDataAsync(response, cancellationToken);
        var receipt = data.Deserialize<BuildingModelGeometrySummary>(Json)
            ?? throw new ApplianceApiException(
                ApplianceApiException.ProtocolErrorCode,
                "The model geometry upload response carried no receipt.",
                (int)response.StatusCode);
        var expectedHash = Convert.ToHexStringLower(SHA256.HashData(content));
        if (!string.Equals(receipt.VersionId, versionId, StringComparison.Ordinal)
            || !string.Equals(receipt.Format, "WEXBIM", StringComparison.Ordinal)
            || receipt.SizeBytes != content.Length
            || !string.Equals(receipt.ContentHash, expectedHash, StringComparison.OrdinalIgnoreCase))
        {
            throw new ApplianceApiException(
                ApplianceApiException.ProtocolErrorCode,
                "The model geometry upload receipt does not match the submitted artifact.",
                (int)response.StatusCode);
        }
    }

    public async Task UploadModelMetadataAsync(
        string bearerToken,
        string propertyId,
        string versionId,
        IReadOnlyList<BuildingModelElementMetadata> elements,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(elements);
        var payload = new UploadModelMetadataRequest(1, elements);
        var relativeUrl =
            $"api/v1/buildings/{Uri.EscapeDataString(propertyId)}/model/versions/"
            + $"{Uri.EscapeDataString(versionId)}/metadata";
        var receipt = await SendJsonAsync<UploadModelMetadataRequest, BuildingModelMetadataReceipt>(
            HttpMethod.Put,
            relativeUrl,
            bearerToken,
            payload,
            cancellationToken);
        var canonical = JsonSerializer.SerializeToUtf8Bytes(payload, Json);
        var expectedHash = Convert.ToHexStringLower(SHA256.HashData(canonical));
        if (!string.Equals(receipt.VersionId, versionId, StringComparison.Ordinal)
            || receipt.FormatVersion != 1
            || receipt.ElementCount != elements.Count
            || receipt.SizeBytes != canonical.Length
            || !string.Equals(receipt.ContentHash, expectedHash, StringComparison.OrdinalIgnoreCase))
        {
            throw new ApplianceApiException(
                ApplianceApiException.ProtocolErrorCode,
                "The model metadata upload receipt does not match the submitted index.",
                200);
        }
    }

    public async Task<BuildingModelSummary> ActivateModelVersionAsync(
        string bearerToken,
        string propertyId,
        string versionId,
        CancellationToken cancellationToken)
    {
        var relativeUrl =
            $"api/v1/buildings/{Uri.EscapeDataString(propertyId)}/model/active";
        using var request = new HttpRequestMessage(
            HttpMethod.Put,
            new Uri(relativeUrl, UriKind.Relative))
        {
            Content = JsonContent.Create(new ActivateModelVersionRequest(versionId), options: Json),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        using var response = await http.SendAsync(request, cancellationToken);
        var data = await ReadEnvelopeDataAsync(response, cancellationToken);
        return data.Deserialize<BuildingModelSummary>(Json)
            ?? throw new ApplianceApiException(
                ApplianceApiException.ProtocolErrorCode,
                "The model activation response carried no model.",
                (int)response.StatusCode);
    }

    public async Task DeleteModelVersionAsync(
        string bearerToken,
        string propertyId,
        string versionId,
        CancellationToken cancellationToken)
    {
        var relativeUrl =
            $"api/v1/buildings/{Uri.EscapeDataString(propertyId)}/model/versions/"
            + Uri.EscapeDataString(versionId);
        using var request = new HttpRequestMessage(
            HttpMethod.Delete,
            new Uri(relativeUrl, UriKind.Relative));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        using var response = await http.SendAsync(request, cancellationToken);
        if (response.StatusCode == HttpStatusCode.NoContent)
        {
            return;
        }

        _ = await ReadEnvelopeDataAsync(response, cancellationToken);
    }

    public Task<AccessSummary> GetAccessSummaryAsync(
        string bearerToken,
        CancellationToken cancellationToken) =>
        GetDataAsync<AccessSummary>("api/v1/access/me", bearerToken, cancellationToken);

    public Task<IReadOnlyList<BimDevice>> GetBuildingDevicesAsync(
        string bearerToken,
        string propertyId,
        CancellationToken cancellationToken) =>
        GetDataListAsync<BimDevice>(
            $"api/v1/devices?buildingPropertyId={Uri.EscapeDataString(propertyId)}",
            bearerToken,
            cancellationToken);

    public Task<BimDevice> SetDevicePositionAsync(
        string bearerToken,
        string deviceId,
        double? x,
        double? y,
        double? z,
        CancellationToken cancellationToken) =>
        SendJsonAsync<DevicePositionUpdate, BimDevice>(
            HttpMethod.Patch,
            $"api/v1/devices/{Uri.EscapeDataString(deviceId)}/position",
            bearerToken,
            new DevicePositionUpdate(x, y, z),
            cancellationToken);

    public Task<BimDevice> SetDeviceIfcLinkAsync(
        string bearerToken,
        string deviceId,
        string? ifcGlobalId,
        CancellationToken cancellationToken) =>
        SendJsonAsync<DeviceIfcLinkUpdate, BimDevice>(
            HttpMethod.Patch,
            $"api/v1/devices/{Uri.EscapeDataString(deviceId)}/ifc-link",
            bearerToken,
            new DeviceIfcLinkUpdate(ifcGlobalId),
            cancellationToken);

    public Task<IReadOnlyList<BimDeviceStatus>> GetBuildingDeviceStatusAsync(
        string bearerToken,
        string propertyId,
        CancellationToken cancellationToken) =>
        GetDataListAsync<BimDeviceStatus>(
            $"api/v1/buildings/{Uri.EscapeDataString(propertyId)}/device-status",
            bearerToken,
            cancellationToken);

    public Task<IReadOnlyList<string>> GetDeviceMetricNamesAsync(
        string bearerToken,
        string deviceId,
        CancellationToken cancellationToken) =>
        GetDataListAsync<string>(
            $"api/v1/devices/{Uri.EscapeDataString(deviceId)}/metric-names",
            bearerToken,
            cancellationToken);

    public Task<IReadOnlyList<BimMetricPoint>> GetDeviceMetricsAsync(
        string bearerToken,
        string deviceId,
        string metric,
        DateTime fromUtc,
        DateTime toUtc,
        CancellationToken cancellationToken)
    {
        var query =
            $"api/v1/devices/{Uri.EscapeDataString(deviceId)}/metrics"
            + $"?metric={Uri.EscapeDataString(metric)}"
            + $"&from={Uri.EscapeDataString(fromUtc.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture))}"
            + $"&to={Uri.EscapeDataString(toUtc.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture))}"
            + "&bucket=1%20minute";
        return GetDataListAsync<BimMetricPoint>(query, bearerToken, cancellationToken);
    }

    public Task<IReadOnlyList<BimStatusEvent>> GetDeviceStatusEventsAsync(
        string bearerToken,
        string deviceId,
        CancellationToken cancellationToken) =>
        GetDataListAsync<BimStatusEvent>(
            $"api/v1/devices/{Uri.EscapeDataString(deviceId)}/status-events?limit=20",
            bearerToken,
            cancellationToken);

    public Task<IReadOnlyList<BcfTopicSummary>> GetBcfTopicsAsync(
        string bearerToken,
        string propertyId,
        CancellationToken cancellationToken) =>
        GetDataListAsync<BcfTopicSummary>(
            $"api/v1/buildings/{Uri.EscapeDataString(propertyId)}/bcf/topics",
            bearerToken,
            cancellationToken);

    public Task<BcfTopic> GetBcfTopicAsync(
        string bearerToken,
        string topicId,
        CancellationToken cancellationToken) =>
        GetDataAsync<BcfTopic>(
            $"api/v1/bcf/topics/{Uri.EscapeDataString(topicId)}",
            bearerToken,
            cancellationToken);

    public Task<BcfTopic> CreateBcfTopicAsync(
        string bearerToken,
        string propertyId,
        CreateBcfTopic topic,
        CancellationToken cancellationToken) =>
        SendJsonAsync<CreateBcfTopic, BcfTopic>(
            HttpMethod.Post,
            $"api/v1/buildings/{Uri.EscapeDataString(propertyId)}/bcf/topics",
            bearerToken,
            topic,
            cancellationToken);

    /// <summary>Shared shape of the list endpoints: envelope <c>data.items</c> as a typed list.</summary>
    private async Task<IReadOnlyList<T>> GetItemsAsync<T>(
        string relativeUrl, string bearerToken, CancellationToken cancellationToken)
    {
        using var request = AuthorizedGet(relativeUrl, bearerToken);
        using var response = await http.SendAsync(request, cancellationToken);
        var data = await ReadEnvelopeDataAsync(response, cancellationToken);

        return data.ValueKind == JsonValueKind.Object && data.TryGetProperty("items", out var items)
            ? items.Deserialize<IReadOnlyList<T>>(Json) ?? []
            : throw new ApplianceApiException(
                ApplianceApiException.ProtocolErrorCode,
                $"The {relativeUrl} response carried no items.", (int)response.StatusCode);
    }

    private async Task<IReadOnlyList<T>> GetDataListAsync<T>(
        string relativeUrl,
        string bearerToken,
        CancellationToken cancellationToken)
    {
        using var request = AuthorizedGet(relativeUrl, bearerToken);
        using var response = await http.SendAsync(request, cancellationToken);
        var data = await ReadEnvelopeDataAsync(response, cancellationToken);

        return data.ValueKind == JsonValueKind.Array
            ? data.Deserialize<IReadOnlyList<T>>(Json) ?? []
            : throw new ApplianceApiException(
                ApplianceApiException.ProtocolErrorCode,
                $"The {relativeUrl} response carried no list.", (int)response.StatusCode);
    }

    private async Task<T> GetDataAsync<T>(
        string relativeUrl,
        string bearerToken,
        CancellationToken cancellationToken)
    {
        using var request = AuthorizedGet(relativeUrl, bearerToken);
        using var response = await http.SendAsync(request, cancellationToken);
        var data = await ReadEnvelopeDataAsync(response, cancellationToken);
        return data.Deserialize<T>(Json)
            ?? throw new ApplianceApiException(
                ApplianceApiException.ProtocolErrorCode,
                $"The {relativeUrl} response carried no data.", (int)response.StatusCode);
    }

    private async Task<TResult> SendJsonAsync<TBody, TResult>(
        HttpMethod method,
        string relativeUrl,
        string bearerToken,
        TBody body,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(
            method,
            new Uri(relativeUrl, UriKind.Relative))
        {
            Content = JsonContent.Create(body, options: Json),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        using var response = await http.SendAsync(request, cancellationToken);
        var data = await ReadEnvelopeDataAsync(response, cancellationToken);
        return data.Deserialize<TResult>(Json)
            ?? throw new ApplianceApiException(
                ApplianceApiException.ProtocolErrorCode,
                $"The {relativeUrl} response carried no data.",
                (int)response.StatusCode);
    }

    private static HttpRequestMessage AuthorizedGet(string relativeUrl, string bearerToken)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, new Uri(relativeUrl, UriKind.Relative));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        return request;
    }

    private static HttpRequestMessage AuthorizedStreamRequest(
        HttpMethod method,
        string relativeUrl,
        string bearerToken,
        Stream content,
        string mediaType)
    {
        var request = new HttpRequestMessage(method, new Uri(relativeUrl, UriKind.Relative))
        {
            Content = new StreamContent(content),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue(mediaType);
        return request;
    }

    /// <summary>Returns the envelope's <c>data</c>, or throws the envelope's error.</summary>
    private static async Task<JsonElement> ReadEnvelopeDataAsync(
        HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        var status = (int)response.StatusCode;

        try
        {
            using var document = JsonDocument.Parse(body);
            var root = document.RootElement;
            if (root.ValueKind == JsonValueKind.Object
                && root.TryGetProperty("success", out var success))
            {
                if (success.ValueKind == JsonValueKind.True)
                {
                    return root.TryGetProperty("data", out var data)
                        ? data.Clone()
                        : default;
                }

                if (root.TryGetProperty("error", out var error))
                {
                    throw new ApplianceApiException(
                        error.GetProperty("code").GetString() ?? "UNKNOWN",
                        error.GetProperty("message").GetString() ?? "Unknown appliance error.",
                        status);
                }
            }
        }
        catch (JsonException)
        {
            // Fall through to the protocol error below.
        }

        throw new ApplianceApiException(
            ApplianceApiException.ProtocolErrorCode,
            $"The server answered HTTP {status} without the NodeScope API envelope - is this a NodeScope appliance URL?",
            status);
    }

    private static ApplianceApiException ModelGeometryTooLarge(int status) => new(
        "MODEL_GEOMETRY_TOO_LARGE",
        "The active model geometry exceeds the desktop safety limit of 200 MiB.",
        status);

    /// <summary>The exchange body; <c>code_verifier</c> keeps its snake_case wire name.</summary>
    private sealed record ExchangeRequest(
        string Code,
        [property: JsonPropertyName("code_verifier")] string CodeVerifier);

    private sealed record ActivateModelVersionRequest(string VersionId);

    private sealed record UploadModelMetadataRequest(
        int FormatVersion,
        IReadOnlyList<BuildingModelElementMetadata> Elements);

    private sealed record DevicePositionUpdate(double? X, double? Y, double? Z);

    private sealed record DeviceIfcLinkUpdate(string? IfcGlobalId);
}
