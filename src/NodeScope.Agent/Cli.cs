using System.Reflection;

namespace NodeScope.Agent;

internal enum CliCommand
{
    Version,
    Enroll,
    Run,
}

internal sealed record ParsedArgs(CliCommand Command, string? Code = null, string? Url = null);

/// <summary>The seams the CLI tests inject; production wiring lives in <see cref="Program"/>.</summary>
internal sealed record CliDependencies
{
    public required Func<EnrollOptions, Task<Credentials>> Enroll { get; init; }

    public required Action<string, Credentials> SaveCredentials { get; init; }

    public required Func<Task<int>> RunDaemon { get; init; }

    public required Action<string> Log { get; init; }
}

internal static class AgentVersion
{
    /// <summary>The informational version baked in at build time, without build metadata.</summary>
    public static string Value { get; } = Compute();

    private static string Compute()
    {
        var informational = typeof(AgentVersion).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        if (string.IsNullOrEmpty(informational))
        {
            return "0.0.0";
        }

        var metadata = informational.IndexOf('+', StringComparison.Ordinal);
        return metadata >= 0 ? informational[..metadata] : informational;
    }
}

internal static class Cli
{
    public static ParsedArgs ParseArgs(IReadOnlyList<string> argv)
    {
        if (argv.Contains("--version") || argv.Contains("-v"))
        {
            return new ParsedArgs(CliCommand.Version);
        }

        if (argv.Count > 0 && argv[0] == "enroll")
        {
            string? code = null;
            string? url = null;
            for (var i = 1; i < argv.Count; i++)
            {
                if (argv[i] == "--code" && i + 1 < argv.Count)
                {
                    code = argv[++i];
                }
                else if (argv[i] == "--url" && i + 1 < argv.Count)
                {
                    url = argv[++i];
                }
            }

            return new ParsedArgs(CliCommand.Enroll, code, url);
        }

        return new ParsedArgs(CliCommand.Run);
    }

    public static async Task<int> RunAsync(IReadOnlyList<string> argv, CliDependencies deps)
    {
        var parsed = ParseArgs(argv);

        if (parsed.Command == CliCommand.Version)
        {
            deps.Log(AgentVersion.Value);
            return 0;
        }

        if (parsed.Command == CliCommand.Enroll)
        {
            if (parsed.Code is null)
            {
                deps.Log("enroll requires --code");
                return 1;
            }

            var config = AgentConfigLoader.Load();
            var credentialsPath = Environment.GetEnvironmentVariable("NODESCOPE_AGENT_CREDENTIALS")
                ?? "/etc/nodescope-agent/credentials.json";

            var credentials = await deps.Enroll(new EnrollOptions
            {
                ApiUrl = parsed.Url ?? config.ApiUrl,
                Code = parsed.Code,
                Name = Environment.MachineName,
                Platform = PlatformName(),
                Version = AgentVersion.Value,
            });
            deps.SaveCredentials(credentialsPath, credentials);
            deps.Log($"Enrolled. Agent ID: {credentials.AgentId}");
            return 0;
        }

        return await deps.RunDaemon();
    }

    /// <summary>Node's os.platform() names, kept so the agents list reads consistently across the fleet.</summary>
    internal static string PlatformName()
    {
        if (OperatingSystem.IsWindows())
        {
            return "win32";
        }

        if (OperatingSystem.IsMacOS())
        {
            return "darwin";
        }

        return "linux";
    }
}
