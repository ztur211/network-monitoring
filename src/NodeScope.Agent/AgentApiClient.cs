using System.IO.Compression;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using NodeScope.Contracts.Monitoring;

namespace NodeScope.Agent;

/// <summary>A non-2xx response from the API, carrying the status code the buffer's retry policy keys on.</summary>
internal sealed class AgentHttpException : Exception
{
    public AgentHttpException()
    {
    }

    public AgentHttpException(string message)
        : base(message)
    {
    }

    public AgentHttpException(string message, Exception innerException)
        : base(message, innerException)
    {
    }

    public AgentHttpException(int statusCode, string message)
        : base(message)
    {
        StatusCode = statusCode;
    }

    public int StatusCode { get; }
}

internal interface IAgentApiClient
{
    public Task<IReadOnlyList<AgentDeviceDto>> SyncDevicesAsync(CancellationToken cancellationToken);

    public Task IngestAsync(IngestBatchDto batch, CancellationToken cancellationToken);

    public Task HeartbeatAsync(CancellationToken cancellationToken);
}

/// <summary>
/// The agent's HTTP surface: device sync, metric ingest, heartbeat - all authenticated by
/// the x-agent-token header. The owning caller configures the <see cref="HttpClient"/>'s
/// timeout; with the default completion option it bounds the whole exchange including body
/// consumption, matching the Node agent's single wall-clock deadline.
/// </summary>
internal sealed class AgentApiClient(HttpClient http, string apiUrl, string token, string version) : IAgentApiClient
{
    /// <summary>Gzip ingest bodies at/above this size; smaller payloads aren't worth the ~20-byte overhead.</summary>
    internal const int IngestGzipMinBytes = 1024;

    public async Task<IReadOnlyList<AgentDeviceDto>> SyncDevicesAsync(CancellationToken cancellationToken)
    {
        using var request = NewRequest(HttpMethod.Get, "/v1/monitoring/agent/devices");
        using var response = await http.SendAsync(request, cancellationToken);
        EnsureSuccess(response, "GET", "/v1/monitoring/agent/devices");
        var envelope = await response.Content.ReadFromJsonAsync(
            AgentJsonContext.Default.EnvelopeIReadOnlyListAgentDeviceDto, cancellationToken);
        return envelope?.Data ?? [];
    }

    public async Task IngestAsync(IngestBatchDto batch, CancellationToken cancellationToken)
    {
        var json = JsonSerializer.SerializeToUtf8Bytes(batch, AgentJsonContext.Default.IngestBatchDto);
        using var request = NewRequest(HttpMethod.Post, "/v1/monitoring/ingest");
        // Compress larger batches on the wire; the API auto-inflates (express.json inflate:true).
        using var content = json.Length >= IngestGzipMinBytes
            ? GzipContent(json)
            : new ByteArrayContent(json);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        request.Content = content;
        using var response = await http.SendAsync(request, cancellationToken);
        EnsureSuccess(response, "POST", "/v1/monitoring/ingest");
    }

    public async Task HeartbeatAsync(CancellationToken cancellationToken)
    {
        using var request = NewRequest(HttpMethod.Post, "/v1/monitoring/agent/heartbeat");
        // Carries the running version so self-updates are visible fleet-wide. The Node API
        // handler binds no body (ValidationPipe never sees it); the C# API persists it.
        var body = JsonSerializer.Serialize(
            new AgentHeartbeatRequest { Version = version }, AgentJsonContext.Default.AgentHeartbeatRequest);
        request.Content = new StringContent(body, Encoding.UTF8, "application/json");
        using var response = await http.SendAsync(request, cancellationToken);
        EnsureSuccess(response, "POST", "/v1/monitoring/agent/heartbeat");
    }

    private HttpRequestMessage NewRequest(HttpMethod method, string path)
    {
        var request = new HttpRequestMessage(method, new Uri(apiUrl + path));
        request.Headers.Add("x-agent-token", token);
        return request;
    }

    private static ByteArrayContent GzipContent(byte[] json)
    {
        using var buffer = new MemoryStream();
        using (var gzip = new GZipStream(buffer, CompressionLevel.Fastest))
        {
            gzip.Write(json);
        }

        var content = new ByteArrayContent(buffer.ToArray());
        content.Headers.ContentEncoding.Add("gzip");
        return content;
    }

    private static void EnsureSuccess(HttpResponseMessage response, string method, string path)
    {
        if (!response.IsSuccessStatusCode)
        {
            throw new AgentHttpException((int)response.StatusCode, $"{method} {path} -> {(int)response.StatusCode}");
        }
    }
}
