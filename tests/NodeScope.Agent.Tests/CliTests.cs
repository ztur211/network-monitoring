using NodeScope.Agent;
using Xunit;

namespace NodeScope.Agent.Tests;

public class ParseArgsTests
{
    [Fact]
    public void Returns_version_command_for_version_flag()
    {
        Assert.Equal(new ParsedArgs(CliCommand.Version), Cli.ParseArgs(["--version"]));
        Assert.Equal(new ParsedArgs(CliCommand.Version), Cli.ParseArgs(["-v"]));
    }

    [Fact]
    public void Returns_enroll_command_with_code_and_url()
    {
        Assert.Equal(
            new ParsedArgs(CliCommand.Enroll, "abc", "http://x"),
            Cli.ParseArgs(["enroll", "--code", "abc", "--url", "http://x"]));
    }

    [Fact]
    public void Returns_enroll_command_with_only_code()
    {
        Assert.Equal(new ParsedArgs(CliCommand.Enroll, "XYZ"), Cli.ParseArgs(["enroll", "--code", "XYZ"]));
    }

    [Fact]
    public void Returns_run_command_for_no_args_and_unrecognised_args()
    {
        Assert.Equal(new ParsedArgs(CliCommand.Run), Cli.ParseArgs([]));
        Assert.Equal(new ParsedArgs(CliCommand.Run), Cli.ParseArgs(["daemon"]));
    }
}

public class RunCliTests
{
    private sealed class Capture
    {
        public List<string> Logs { get; } = [];

        public List<EnrollOptions> EnrollCalls { get; } = [];

        public List<(string Path, Credentials Credentials)> Saved { get; } = [];

        public int DaemonCalls { get; private set; }

        public CliDependencies Deps => new()
        {
            Enroll = options =>
            {
                EnrollCalls.Add(options);
                return Task.FromResult(new Credentials { AgentId = "agent-1", Token = "tok-abc" });
            },
            SaveCredentials = (path, credentials) => Saved.Add((path, credentials)),
            RunDaemon = () =>
            {
                DaemonCalls++;
                return Task.FromResult(0);
            },
            Log = Logs.Add,
        };
    }

    [Fact]
    public async Task Version_prints_version_string_and_returns_0()
    {
        var capture = new Capture();
        var exit = await Cli.RunAsync(["--version"], capture.Deps);
        Assert.Contains(AgentVersion.Value, capture.Logs);
        Assert.Equal(0, exit);
    }

    [Fact]
    public void Agent_version_is_a_non_empty_version_string()
    {
        Assert.False(string.IsNullOrEmpty(AgentVersion.Value));
        Assert.NotEqual("0.0.0", AgentVersion.Value); // the csproj bakes in a real version
    }

    [Fact]
    public async Task Enroll_calls_enroll_and_save_credentials_then_returns_0()
    {
        var capture = new Capture();
        var exit = await Cli.RunAsync(["enroll", "--code", "abc", "--url", "http://x"], capture.Deps);

        var call = Assert.Single(capture.EnrollCalls);
        Assert.Equal("abc", call.Code);
        Assert.Equal("http://x", call.ApiUrl);
        var saved = Assert.Single(capture.Saved);
        Assert.Equal(new Credentials { AgentId = "agent-1", Token = "tok-abc" }, saved.Credentials);
        Assert.False(string.IsNullOrEmpty(saved.Path));
        Assert.Equal(0, exit);
    }

    [Fact]
    public async Task Enroll_without_code_returns_1_and_logs_error()
    {
        var capture = new Capture();
        var exit = await Cli.RunAsync(["enroll"], capture.Deps);
        Assert.Equal(1, exit);
        Assert.Empty(capture.EnrollCalls);
        Assert.Contains("enroll requires --code", capture.Logs);
    }

    [Fact]
    public async Task No_args_runs_the_daemon()
    {
        var capture = new Capture();
        await Cli.RunAsync([], capture.Deps);
        Assert.Equal(1, capture.DaemonCalls);
    }
}
