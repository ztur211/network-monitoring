using NodeScope.Agent;
using Xunit;
using static NodeScope.Agent.Tests.TestData;

namespace NodeScope.Agent.Tests;

public class AgentConfigTests
{
    private static Dictionary<string, string?> Env(params (string Key, string Value)[] entries) =>
        entries.ToDictionary(e => e.Key, e => (string?)e.Value, StringComparer.Ordinal);

    private static string WriteConfig(string json)
    {
        var path = TempPath("config.json");
        File.WriteAllText(path, json);
        return path;
    }

    [Fact]
    public void Reads_a_config_file_and_applies_env_overrides_and_defaults()
    {
        var path = WriteConfig("""{"apiUrl":"http://host/api","probeIntervalMs":15000}""");
        var config = AgentConfigLoader.Load(path, Env(("NODESCOPE_AGENT_CONCURRENCY", "8")));

        Assert.Equal("http://host/api", config.ApiUrl);
        Assert.Equal(15_000, config.ProbeIntervalMs);
        Assert.Equal(8, config.Concurrency);          // env override
        Assert.Equal([443, 80, 22], config.Ports);    // default
        Assert.Equal(300_000, config.SyncIntervalMs); // default
    }

    [Fact]
    public void Returns_all_defaults_when_config_file_contains_null()
    {
        var config = AgentConfigLoader.Load(WriteConfig("null"), Env());
        Assert.Equal("http://localhost:3000/api", config.ApiUrl);
        Assert.Equal(20, config.Concurrency);
        Assert.Equal([443, 80, 22], config.Ports);
        Assert.True(config.IcmpEnabled);
    }

    [Fact]
    public void Returns_all_defaults_when_config_file_contains_an_array()
    {
        var config = AgentConfigLoader.Load(WriteConfig("[]"), Env());
        Assert.Equal("http://localhost:3000/api", config.ApiUrl);
        Assert.Equal(20, config.Concurrency);
        Assert.Equal(300_000, config.SyncIntervalMs);
    }

    [Fact]
    public void Returns_all_defaults_when_config_file_is_missing()
    {
        var config = AgentConfigLoader.Load(Path.Combine(Path.GetTempPath(), "nope", "missing.json"), Env());
        Assert.Equal("http://localhost:3000/api", config.ApiUrl);
        Assert.Equal(2_000, config.TimeoutMs);
    }

    [Fact]
    public void Uses_default_concurrency_when_env_var_is_empty_string()
    {
        var config = AgentConfigLoader.Load(
            WriteConfig("{}"),
            new Dictionary<string, string?>(StringComparer.Ordinal) { ["NODESCOPE_AGENT_CONCURRENCY"] = "" });
        Assert.Equal(20, config.Concurrency);
    }

    [Fact]
    public void Reads_icmp_enabled_false_from_config_file()
    {
        var config = AgentConfigLoader.Load(WriteConfig("""{"icmpEnabled":false}"""), Env());
        Assert.False(config.IcmpEnabled);
    }

    [Fact]
    public void Auto_update_defaults_on_with_an_hourly_interval_and_derived_url()
    {
        var config = AgentConfigLoader.Load(WriteConfig("{}"), Env());
        Assert.True(config.AutoUpdate);
        Assert.Equal(3_600_000, config.UpdateIntervalMs);
        Assert.Null(config.UpdateUrl);
    }

    [Theory]
    [InlineData("off")]
    [InlineData("false")]
    [InlineData("0")]
    public void Auto_update_env_opt_out_forms_all_disable(string value)
    {
        var config = AgentConfigLoader.Load(WriteConfig("{}"), Env(("NODESCOPE_AGENT_AUTO_UPDATE", value)));
        Assert.False(config.AutoUpdate);
    }

    [Fact]
    public void Auto_update_env_on_overrides_file_off()
    {
        var config = AgentConfigLoader.Load(
            WriteConfig("""{"autoUpdate":false}"""), Env(("NODESCOPE_AGENT_AUTO_UPDATE", "on")));
        Assert.True(config.AutoUpdate);
    }

    [Fact]
    public void Reads_auto_update_off_from_config_file()
    {
        var config = AgentConfigLoader.Load(WriteConfig("""{"autoUpdate":false}"""), Env());
        Assert.False(config.AutoUpdate);
    }

    [Fact]
    public void Update_url_env_overrides_file()
    {
        var config = AgentConfigLoader.Load(
            WriteConfig("""{"updateUrl":"http://file/agent/manifest.json"}"""),
            Env(("NODESCOPE_AGENT_UPDATE_URL", "http://env/agent/manifest.json")));
        Assert.Equal("http://env/agent/manifest.json", config.UpdateUrl);
    }

    [Fact]
    public void Env_api_url_overrides_file_set_api_url()
    {
        var path = WriteConfig("""{"apiUrl":"http://file-host/api"}""");
        var config = AgentConfigLoader.Load(path, Env(("NODESCOPE_AGENT_API_URL", "http://env-host/api")));
        Assert.Equal("http://env-host/api", config.ApiUrl);
    }

    [Fact]
    public void Ports_env_var_parses_comma_separated_list()
    {
        var config = AgentConfigLoader.Load(WriteConfig("{}"), Env(("NODESCOPE_AGENT_PORTS", "8080,443")));
        Assert.Equal([8080, 443], config.Ports);
    }
}

public class CachedFetchTests
{
    private static readonly string[] ValueA = ["a"];
    private static readonly string[] ValueOk = ["ok"];

    [Fact]
    public async Task Caches_within_the_interval_and_refetches_once_it_elapses()
    {
        var now = 1000L;
        var fetches = 0;
        var cached = new CachedFetch<string[]>(
            () =>
            {
                fetches++;
                return Task.FromResult(ValueA);
            },
            intervalMs: 5000,
            nowMs: () => now);

        Assert.Equal(["a"], await cached.GetAsync()); // first call -> fetch
        Assert.Equal(["a"], await cached.GetAsync()); // within interval -> cached
        now += 4999;
        await cached.GetAsync(); // still within interval -> cached
        Assert.Equal(1, fetches);

        now += 2; // 5001ms since last fetch -> re-fetch
        await cached.GetAsync();
        Assert.Equal(2, fetches);
    }

    [Fact]
    public async Task Does_not_cache_a_failed_fetch_and_retries_on_the_next_call()
    {
        var fetches = 0;
        var cached = new CachedFetch<string[]>(
            () => ++fetches == 1
                ? Task.FromException<string[]>(new InvalidOperationException("boom"))
                : Task.FromResult(ValueOk),
            intervalMs: 10_000,
            nowMs: () => 0);

        await Assert.ThrowsAsync<InvalidOperationException>(() => cached.GetAsync()); // failed -> not cached
        Assert.Equal(["ok"], await cached.GetAsync()); // retries immediately despite the interval
        Assert.Equal(2, fetches);
    }

    [Fact]
    public async Task Shares_one_inflight_fetch_across_concurrent_callers()
    {
        var fetches = 0;
        var gate = new TaskCompletionSource<string[]>();
        var cached = new CachedFetch<string[]>(
            () =>
            {
                fetches++;
                return gate.Task;
            },
            intervalMs: 5000,
            nowMs: () => 0);

        var first = cached.GetAsync();
        var second = cached.GetAsync(); // arrives while the first fetch is still pending
        gate.SetResult(["x"]);

        Assert.Equal(["x"], await first);
        Assert.Equal(["x"], await second);
        Assert.Equal(1, fetches); // one real fetch, not two
    }
}
