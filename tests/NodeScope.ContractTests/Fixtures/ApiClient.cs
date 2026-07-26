using System.Net.Http.Headers;
using System.Text;

namespace NodeScope.ContractTests.Fixtures;

/// <summary>A response captured as raw bytes, for non-JSON bodies (the bandwidth
/// payload, file downloads).</summary>
/// <param name="Status">The HTTP status.</param>
/// <param name="Body">The body bytes, verbatim.</param>
/// <param name="Headers">Response + content headers, first value each, keyed case-insensitively.</param>
public sealed record RawResponse(
    HttpStatusCode Status,
    IReadOnlyList<byte> Body,
    IReadOnlyDictionary<string, string> Headers)
{
    /// <summary>A single response header value, or null if absent.</summary>
    public string? Header(string name) => Headers.TryGetValue(name, out var value) ? value : null;
}

/// <summary>
/// A thin black-box HTTP client for the API under test. It knows the wire - the
/// standard JSON envelope, bearer/header auth - and nothing about the
/// implementation. Request paths are relative to the client's base address, which
/// the fixture sets to <c>{BASE_URL}/api/</c>, so callers pass <c>v1/users/me</c>,
/// <c>v1/auth/sign-in</c>, <c>health</c>, and so on.
/// </summary>
public sealed class ApiClient
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _http;

    public ApiClient(HttpClient http) => _http = http;

    public Task<ApiResponse> GetAsync(string path, Auth? auth = null, CancellationToken cancellationToken = default) =>
        SendAsync(HttpMethod.Get, path, null, auth, cancellationToken);

    public Task<ApiResponse> PostAsync(string path, object? body = null, Auth? auth = null, CancellationToken cancellationToken = default) =>
        SendAsync(HttpMethod.Post, path, body, auth, cancellationToken);

    public Task<ApiResponse> PatchAsync(string path, object? body = null, Auth? auth = null, CancellationToken cancellationToken = default) =>
        SendAsync(HttpMethod.Patch, path, body, auth, cancellationToken);

    public Task<ApiResponse> PutAsync(string path, object? body = null, Auth? auth = null, CancellationToken cancellationToken = default) =>
        SendAsync(HttpMethod.Put, path, body, auth, cancellationToken);

    public Task<ApiResponse> DeleteAsync(string path, Auth? auth = null, CancellationToken cancellationToken = default) =>
        SendAsync(HttpMethod.Delete, path, null, auth, cancellationToken);

    /// <summary>
    /// GETs a response as raw bytes - for the endpoints whose body is not JSON
    /// (the bandwidth payload, file downloads), where reading via a string would
    /// mangle the bytes and hide the true length.
    /// </summary>
    public async Task<RawResponse> GetRawAsync(
        string path,
        Auth? auth = null,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(path.TrimStart('/'), UriKind.Relative));
        ApplyAuth(request, auth);

        using var response = await _http.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsByteArrayAsync(cancellationToken);

        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var header in response.Headers)
        {
            headers[header.Key] = string.Join(",", header.Value);
        }

        foreach (var header in response.Content.Headers)
        {
            headers[header.Key] = string.Join(",", header.Value);
        }

        return new RawResponse(response.StatusCode, body, headers);
    }

    /// <summary>
    /// POSTs raw bytes as the request body - the shape of the building-model version
    /// upload, which streams the file straight off the request rather than multipart.
    /// </summary>
    public async Task<ApiResponse> PostRawAsync(
        string path,
        byte[] body,
        string contentType = "application/octet-stream",
        Auth? auth = null,
        CancellationToken cancellationToken = default) =>
        await SendRawAsync(HttpMethod.Post, path, body, contentType, auth, cancellationToken);

    /// <summary>PUTs raw bytes, used by a model version's wexBIM artifact upload.</summary>
    public async Task<ApiResponse> PutRawAsync(
        string path,
        byte[] body,
        string contentType = "application/octet-stream",
        Auth? auth = null,
        CancellationToken cancellationToken = default) =>
        await SendRawAsync(HttpMethod.Put, path, body, contentType, auth, cancellationToken);

    private async Task<ApiResponse> SendRawAsync(
        HttpMethod method,
        string path,
        byte[] body,
        string contentType,
        Auth? auth,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(method, new Uri(path.TrimStart('/'), UriKind.Relative));
        request.Content = new ByteArrayContent(body);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        ApplyAuth(request, auth);

        using var response = await _http.SendAsync(request, cancellationToken);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);

        return ApiResponse.Capture(response.StatusCode, response.Headers, response.Content.Headers, text);
    }

    /// <summary>
    /// POSTs a single file as multipart/form-data - the shape of the BCF import,
    /// which reads an uploaded file field rather than the raw body.
    /// </summary>
    public async Task<ApiResponse> PostMultipartAsync(
        string path,
        string fieldName,
        string fileName,
        byte[] content,
        Auth? auth = null,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(path.TrimStart('/'), UriKind.Relative));
        using var form = new MultipartFormDataContent();
        using var file = new ByteArrayContent(content);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        form.Add(file, fieldName, fileName);
        request.Content = form;
        ApplyAuth(request, auth);

        using var response = await _http.SendAsync(request, cancellationToken);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);

        return ApiResponse.Capture(response.StatusCode, response.Headers, response.Content.Headers, text);
    }

    private async Task<ApiResponse> SendAsync(
        HttpMethod method,
        string path,
        object? body,
        Auth? auth,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(method, new Uri(path.TrimStart('/'), UriKind.Relative));

        if (body is not null)
        {
            var json = JsonSerializer.Serialize(body, JsonOptions);
            request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }

        ApplyAuth(request, auth);

        using var response = await _http.SendAsync(request, cancellationToken);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);

        return ApiResponse.Capture(response.StatusCode, response.Headers, response.Content.Headers, text);
    }

    private static void ApplyAuth(HttpRequestMessage request, Auth? auth)
    {
        if (auth is null)
        {
            return;
        }

        if (auth.BearerToken is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", auth.BearerToken);
        }

        if (auth.Headers is not null)
        {
            foreach (var (name, value) in auth.Headers)
            {
                // Without validation: typed headers like User-Agent would otherwise be
                // format-checked, and the tests want the value on the wire verbatim.
                request.Headers.TryAddWithoutValidation(name, value);
            }
        }
    }
}
