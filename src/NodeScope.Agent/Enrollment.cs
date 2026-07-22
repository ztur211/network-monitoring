using System.Net.Http.Json;
using NodeScope.Contracts.Monitoring;

namespace NodeScope.Agent;

internal sealed record EnrollOptions
{
    public required string ApiUrl { get; init; }

    public required string Code { get; init; }

    public required string Name { get; init; }

    public required string Platform { get; init; }

    public required string Version { get; init; }
}

internal static class Enrollment
{
    /// <summary>Exchange a one-time enrollment code for the agent's persistent credentials.</summary>
    public static async Task<Credentials> EnrollAsync(
        HttpClient http, EnrollOptions options, CancellationToken cancellationToken = default)
    {
        var request = new AgentEnrollRequest
        {
            Code = options.Code,
            Name = options.Name,
            Platform = options.Platform,
            Version = options.Version,
        };
        using var response = await http.PostAsJsonAsync(
            new Uri(options.ApiUrl + "/v1/monitoring/agent/enroll"),
            request,
            AgentJsonContext.Default.AgentEnrollRequest,
            cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new AgentHttpException((int)response.StatusCode, $"enroll failed: {(int)response.StatusCode}");
        }

        var envelope = await response.Content.ReadFromJsonAsync(
            AgentJsonContext.Default.EnvelopeAgentEnrollResponse, cancellationToken);
        if (envelope?.Data is not { } data)
        {
            throw new AgentHttpException("enroll failed: empty response");
        }

        return new Credentials { AgentId = data.AgentId, Token = data.Token };
    }
}
