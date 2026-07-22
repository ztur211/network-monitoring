using System.Net;
using System.Text;
using System.Text.Json;
using NodeScope.Agent;
using Xunit;

namespace NodeScope.Agent.Tests;

public class EnrollmentTests
{
    private sealed class FakeHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public List<(HttpRequestMessage Request, string Body)> Calls { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content is null
                ? ""
                : await request.Content.ReadAsStringAsync(cancellationToken);
            Calls.Add((request, body));
            return respond(request);
        }
    }

    private static EnrollOptions Options => new()
    {
        ApiUrl = "http://h/api",
        Code = "CODE123",
        Name = "host-1",
        Platform = "linux",
        Version = "0.1.0",
    };

    [Fact]
    public async Task Posts_the_enroll_request_and_parses_the_envelope()
    {
        using var handler = new FakeHandler(_ => new HttpResponseMessage(HttpStatusCode.Created)
        {
            Content = new StringContent(
                """{"success":true,"data":{"agentId":"agent-9","token":"tok-9"},"timestamp":""}""",
                Encoding.UTF8,
                "application/json"),
        });
        using var http = new HttpClient(handler);

        var credentials = await Enrollment.EnrollAsync(http, Options);

        Assert.Equal(new Credentials { AgentId = "agent-9", Token = "tok-9" }, credentials);
        var (request, body) = Assert.Single(handler.Calls);
        Assert.Equal("http://h/api/v1/monitoring/agent/enroll", request.RequestUri!.ToString());
        using var parsed = JsonDocument.Parse(body);
        Assert.Equal("CODE123", parsed.RootElement.GetProperty("code").GetString());
        Assert.Equal("host-1", parsed.RootElement.GetProperty("name").GetString());
        Assert.Equal("linux", parsed.RootElement.GetProperty("platform").GetString());
        Assert.Equal("0.1.0", parsed.RootElement.GetProperty("version").GetString());
    }

    [Fact]
    public async Task Throws_with_the_status_on_a_rejected_code()
    {
        using var handler = new FakeHandler(_ => new HttpResponseMessage(HttpStatusCode.Unauthorized));
        using var http = new HttpClient(handler);

        var error = await Assert.ThrowsAsync<AgentHttpException>(() => Enrollment.EnrollAsync(http, Options));
        Assert.Equal(401, error.StatusCode);
        Assert.Contains("enroll failed: 401", error.Message, StringComparison.Ordinal);
    }
}
