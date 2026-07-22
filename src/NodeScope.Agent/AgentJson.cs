using System.Text.Json.Serialization;
using NodeScope.Contracts.Monitoring;

namespace NodeScope.Agent;

/// <summary>The API's standard response envelope; the agent reads only <c>data</c>.</summary>
internal sealed record Envelope<T>
{
    public T? Data { get; init; }
}

/// <summary>
/// Source-generated JSON for everything the agent reads or writes. AOT-compiled binaries
/// cannot fall back to reflection-based serialization, so every payload type is registered
/// here. The wire format is camelCase to match the Node API.
/// </summary>
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(IngestBatchDto))]
[JsonSerializable(typeof(AgentEnrollRequest))]
[JsonSerializable(typeof(Envelope<AgentEnrollResponse>))]
[JsonSerializable(typeof(Envelope<IReadOnlyList<AgentDeviceDto>>))]
[JsonSerializable(typeof(Credentials))]
[JsonSerializable(typeof(AgentConfigFile))]
internal sealed partial class AgentJsonContext : JsonSerializerContext;
