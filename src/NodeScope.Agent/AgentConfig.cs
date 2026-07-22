using System.Text.Json;

namespace NodeScope.Agent;

internal sealed record AgentConfig
{
    public required string ApiUrl { get; init; }

    public required int SyncIntervalMs { get; init; }

    public required int ProbeIntervalMs { get; init; }

    public required int Concurrency { get; init; }

    public required IReadOnlyList<int> Ports { get; init; }

    public required bool IcmpEnabled { get; init; }

    public required int TimeoutMs { get; init; }
}

/// <summary>The optional JSON config file's shape - every field falls back to a default.</summary>
internal sealed record AgentConfigFile
{
    public string? ApiUrl { get; init; }

    public int? SyncIntervalMs { get; init; }

    public int? ProbeIntervalMs { get; init; }

    public int? Concurrency { get; init; }

    public IReadOnlyList<int>? Ports { get; init; }

    public bool? IcmpEnabled { get; init; }

    public int? TimeoutMs { get; init; }
}

/// <summary>
/// Config precedence, matching the Node agent exactly: environment variable, then config
/// file field, then default. A missing or malformed config file means defaults, never a
/// crash - the agent must come up on a bare host.
/// </summary>
internal static class AgentConfigLoader
{
    public static AgentConfig Load(
        string? configPath = null,
        IReadOnlyDictionary<string, string?>? env = null)
    {
        env ??= EnvironmentVariables();
        var path = configPath
            ?? env.GetValueOrDefault("NODESCOPE_AGENT_CONFIG")
            ?? "/etc/nodescope-agent/config.json";

        var file = ReadFile(path);

        return new AgentConfig
        {
            ApiUrl = env.GetValueOrDefault("NODESCOPE_AGENT_API_URL")
                ?? file.ApiUrl
                ?? "http://localhost:3000/api",
            SyncIntervalMs = Num(env.GetValueOrDefault("NODESCOPE_AGENT_SYNC_INTERVAL_MS"), file.SyncIntervalMs ?? 300_000),
            ProbeIntervalMs = Num(env.GetValueOrDefault("NODESCOPE_AGENT_PROBE_INTERVAL_MS"), file.ProbeIntervalMs ?? 30_000),
            Concurrency = Num(env.GetValueOrDefault("NODESCOPE_AGENT_CONCURRENCY"), file.Concurrency ?? 20),
            Ports = ParsePorts(env.GetValueOrDefault("NODESCOPE_AGENT_PORTS"), file.Ports),
            IcmpEnabled = env.GetValueOrDefault("NODESCOPE_AGENT_ICMP") is { } icmp
                ? icmp != "false"
                : file.IcmpEnabled ?? true,
            TimeoutMs = Num(env.GetValueOrDefault("NODESCOPE_AGENT_TIMEOUT_MS"), file.TimeoutMs ?? 2_000),
        };
    }

    private static AgentConfigFile ReadFile(string path)
    {
        try
        {
            var parsed = JsonSerializer.Deserialize(File.ReadAllText(path), AgentJsonContext.Default.AgentConfigFile);
            return parsed ?? new AgentConfigFile();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException)
        {
            return new AgentConfigFile();
        }
    }

    private static int Num(string? value, int fallback) =>
        !string.IsNullOrEmpty(value) && int.TryParse(value, out var parsed) ? parsed : fallback;

    private static IReadOnlyList<int> ParsePorts(string? env, IReadOnlyList<int>? file)
    {
        if (env is null)
        {
            return file ?? [443, 80, 22];
        }

        var ports = new List<int>();
        foreach (var part in env.Split(','))
        {
            if (int.TryParse(part.Trim(), out var port))
            {
                ports.Add(port);
            }
        }

        return ports;
    }

    private static Dictionary<string, string?> EnvironmentVariables()
    {
        var result = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables())
        {
            result[(string)entry.Key] = entry.Value as string;
        }

        return result;
    }
}
