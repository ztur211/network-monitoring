using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.Json;
using NodeScope.Agent;
using NodeScope.Contracts.Monitoring;
using Xunit;

namespace NodeScope.Agent.Tests;

public class AgentApiClientTests
{
    /// <summary>Records every request (with body, since the content is disposed with the request) and replays a canned response.</summary>
    private sealed class FakeHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public List<(HttpRequestMessage Request, byte[] Body)> Calls { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content is null
                ? []
                : await request.Content.ReadAsByteArrayAsync(cancellationToken);
            Calls.Add((request, body));
            return respond(request);
        }
    }

    private sealed class StallingHandler : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            throw new InvalidOperationException("unreachable");
        }
    }

    private static FakeHandler Ok(string payload) => new(_ => new HttpResponseMessage(HttpStatusCode.OK)
    {
        Content = new StringContent(payload, Encoding.UTF8, "application/json"),
    });

    private static AgentApiClient Client(HttpClient http) => new(http, "http://h/api", "tok", "1.2.3");

    [Fact]
    public async Task SyncDevices_gets_with_the_agent_token()
    {
        using var handler = Ok("""{"success":true,"data":[{"id":"d","name":"D","ipAddress":"10.0.0.1"}],"timestamp":""}""");
        using var http = new HttpClient(handler);
        var devices = await Client(http).SyncDevicesAsync(CancellationToken.None);

        Assert.Single(devices);
        var (request, _) = Assert.Single(handler.Calls);
        Assert.Equal("http://h/api/v1/monitoring/agent/devices", request.RequestUri!.ToString());
        Assert.Equal("tok", Assert.Single(request.Headers.GetValues("x-agent-token")));
    }

    [Fact]
    public async Task Ingest_posts_the_batch()
    {
        using var handler = Ok("""{"success":true,"data":{"accepted":1}}""");
        using var http = new HttpClient(handler);
        await Client(http).IngestAsync(
            new IngestBatchDto
            {
                Checks = [new StatusCheckDto { DeviceId = "d", Ok = true, LatencyMs = 5 }],
                Metrics = [],
            },
            CancellationToken.None);

        var (request, _) = Assert.Single(handler.Calls);
        Assert.Equal("http://h/api/v1/monitoring/ingest", request.RequestUri!.ToString());
        Assert.Equal(HttpMethod.Post, request.Method);
    }

    [Fact]
    public async Task Gzips_a_large_ingest_batch_and_round_trips_to_the_same_json()
    {
        using var handler = Ok("""{"success":true,"data":{"accepted":60}}""");
        using var http = new HttpClient(handler);
        var batch = new IngestBatchDto
        {
            Checks = Enumerable.Range(0, 60)
                .Select(i => new StatusCheckDto { DeviceId = $"device-{i}", Ok = true, LatencyMs = i })
                .ToList(),
            Metrics = [],
        };
        await Client(http).IngestAsync(batch, CancellationToken.None);

        var (request, body) = Assert.Single(handler.Calls);
        Assert.Equal("gzip", Assert.Single(request.Content!.Headers.ContentEncoding));

        using var inflated = new GZipStream(new MemoryStream(body), CompressionMode.Decompress);
        var roundTripped = await JsonSerializer.DeserializeAsync(inflated, AgentJsonContext.Default.IngestBatchDto);
        Assert.NotNull(roundTripped);
        Assert.Equal(batch.Checks, roundTripped.Checks); // element-wise; the DTOs are value-equal records
        Assert.Equal(batch.Metrics, roundTripped.Metrics);
    }

    [Fact]
    public async Task Sends_a_small_ingest_batch_uncompressed()
    {
        using var handler = Ok("""{"success":true,"data":{"accepted":1}}""");
        using var http = new HttpClient(handler);
        await Client(http).IngestAsync(
            new IngestBatchDto { Checks = [new StatusCheckDto { DeviceId = "d", Ok = true }], Metrics = [] },
            CancellationToken.None);

        var (request, body) = Assert.Single(handler.Calls);
        Assert.Empty(request.Content!.Headers.ContentEncoding);
        Assert.Contains("\"deviceId\":\"d\"", Encoding.UTF8.GetString(body), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Omitted_optional_fields_are_absent_from_the_wire_not_null()
    {
        using var handler = Ok("""{"success":true,"data":{"accepted":1}}""");
        using var http = new HttpClient(handler);
        await Client(http).IngestAsync(
            new IngestBatchDto { Checks = [new StatusCheckDto { DeviceId = "d", Ok = false }], Metrics = [] },
            CancellationToken.None);

        var (_, body) = Assert.Single(handler.Calls);
        Assert.DoesNotContain("latencyMs", Encoding.UTF8.GetString(body), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Heartbeat_posts_the_running_version()
    {
        using var handler = new FakeHandler(_ => new HttpResponseMessage(HttpStatusCode.NoContent));
        using var http = new HttpClient(handler);
        await Client(http).HeartbeatAsync(CancellationToken.None);

        var (request, body) = Assert.Single(handler.Calls);
        Assert.Equal("http://h/api/v1/monitoring/agent/heartbeat", request.RequestUri!.ToString());
        Assert.Equal("""{"version":"1.2.3"}""", Encoding.UTF8.GetString(body));
    }

    [Fact]
    public async Task Throws_with_the_status_code_on_a_401()
    {
        using var handler = new FakeHandler(_ => new HttpResponseMessage(HttpStatusCode.Unauthorized));
        using var http = new HttpClient(handler);
        var error = await Assert.ThrowsAsync<AgentHttpException>(
            () => Client(http).HeartbeatAsync(CancellationToken.None));
        Assert.Equal(401, error.StatusCode);
        Assert.Contains("401", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_stalled_response_hits_the_deadline_as_a_transient_error()
    {
        // The HttpClient timeout must bound the whole exchange. A cancellation-shaped failure
        // is what the buffer treats as transient, so a stall never drops data.
        using var handler = new StallingHandler();
        using var http = new HttpClient(handler) { Timeout = TimeSpan.FromMilliseconds(100) };

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => Client(http).SyncDevicesAsync(CancellationToken.None));
    }
}
