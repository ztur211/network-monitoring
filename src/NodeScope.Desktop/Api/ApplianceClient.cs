using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
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

    private static HttpRequestMessage AuthorizedGet(string relativeUrl, string bearerToken)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, new Uri(relativeUrl, UriKind.Relative));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
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

    /// <summary>The exchange body; <c>code_verifier</c> keeps its snake_case wire name.</summary>
    private sealed record ExchangeRequest(
        string Code,
        [property: JsonPropertyName("code_verifier")] string CodeVerifier);
}
