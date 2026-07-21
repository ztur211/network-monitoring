using System.Net.Http.Headers;
using System.Text;

namespace NodeScope.ContractTests.Fixtures;

/// <summary>
/// A thin black-box HTTP client for the API under test. It knows the wire - the
/// standard JSON envelope, cookie/bearer/header auth - and nothing about either
/// implementation. Request paths are relative to the client's base address, which
/// the fixture sets to <c>{BASE_URL}/api/</c>, so callers pass <c>v1/users/me</c>,
/// <c>auth/sign-in/email</c>, <c>health</c>, and so on.
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
    /// POSTs raw bytes as the request body - the shape of the building-model version
    /// upload, which streams the file straight off the request rather than multipart.
    /// </summary>
    public async Task<ApiResponse> PostRawAsync(
        string path,
        byte[] body,
        string contentType = "application/octet-stream",
        Auth? auth = null,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(path.TrimStart('/'), UriKind.Relative));
        request.Content = new ByteArrayContent(body);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        ApplyAuth(request, auth);

        using var response = await _http.SendAsync(request, cancellationToken);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        var setCookies = response.Headers.TryGetValues("Set-Cookie", out var cookies)
            ? cookies.ToArray()
            : [];

        return ApiResponse.Capture(response.StatusCode, response.Headers, response.Content.Headers, setCookies, text);
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
        var setCookies = response.Headers.TryGetValues("Set-Cookie", out var cookies)
            ? cookies.ToArray()
            : [];

        return ApiResponse.Capture(response.StatusCode, response.Headers, response.Content.Headers, setCookies, text);
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

        if (auth.Cookie is not null)
        {
            request.Headers.Add("Cookie", auth.Cookie);
        }

        if (auth.Headers is not null)
        {
            foreach (var (name, value) in auth.Headers)
            {
                request.Headers.Add(name, value);
            }
        }
    }
}
