using NodeScope.Modules.Monitoring.Application.Prober;
using Xunit;

namespace NodeScope.Monitoring.Tests;

/// <summary>Ports of the Node <c>parsePorts</c> + config specs, envInt semantics included.</summary>
public sealed class ProberOptionsTests
{
    private static ProberOptions FromEnv(Dictionary<string, string?> env) =>
        ProberOptions.FromEnvironment(key => env.GetValueOrDefault(key));

    [Fact]
    public void ParsePorts_parses_a_normal_list()
    {
        Assert.Equal([443, 80, 22], ProberOptions.ParsePorts("443,80,22"));
    }

    [Fact]
    public void ParsePorts_tolerates_whitespace()
    {
        Assert.Equal([443, 80], ProberOptions.ParsePorts(" 443 , 80 "));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void ParsePorts_falls_back_to_the_default_set_when_unset(string? raw)
    {
        Assert.Equal([443, 80, 22], ProberOptions.ParsePorts(raw));
    }

    [Fact]
    public void ParsePorts_drops_non_integer_and_out_of_range_entries()
    {
        Assert.Equal([443], ProberOptions.ParsePorts("abc,99999,0,-5,443,12.5"));
    }

    [Fact]
    public void ParsePorts_can_end_up_empty_when_every_entry_is_invalid()
    {
        Assert.Empty(ProberOptions.ParsePorts("abc,99999"));
    }

    [Theory]
    [InlineData("true", true)]
    [InlineData("TRUE", false)]
    [InlineData("1", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void Enabled_only_on_the_literal_lowercase_true(string? raw, bool expected)
    {
        Assert.Equal(expected, FromEnv(new() { ["MONITORING_PROBER_ENABLED"] = raw }).Enabled);
    }

    [Theory]
    [InlineData("false", false)]
    [InlineData("FALSE", true)]
    [InlineData("0", true)]
    [InlineData(null, true)]
    public void Icmp_disabled_only_by_the_literal_lowercase_false(string? raw, bool expected)
    {
        Assert.Equal(expected, FromEnv(new() { ["MONITORING_ICMP_ENABLED"] = raw }).IcmpEnabled);
    }

    [Fact]
    public void Defaults_match_the_node_prober()
    {
        var options = FromEnv([]);
        Assert.False(options.Enabled);
        Assert.Equal(30_000, options.IntervalMs);
        Assert.Equal(20, options.Concurrency);
        Assert.True(options.IcmpEnabled);
        Assert.Equal([443, 80, 22], options.Ports);
        Assert.Equal(2000, options.TimeoutMs);
    }

    [Theory]
    [InlineData("", 30_000)]     // empty -> fallback
    [InlineData("abc", 30_000)]  // non-integer -> fallback
    [InlineData("500", 30_000)]  // below min 1000 -> FALLBACK, not the bound (envInt semantics)
    [InlineData("1000", 1000)]
    [InlineData("60000", 60_000)]
    public void Interval_uses_envInt_semantics(string raw, int expected)
    {
        Assert.Equal(expected, FromEnv(new() { ["MONITORING_PROBE_INTERVAL_MS"] = raw }).IntervalMs);
    }

    [Theory]
    [InlineData("0", 20)]     // below min 1 -> fallback
    [InlineData("501", 500)]  // above max -> CLAMPED to the bound
    [InlineData("500", 500)]
    [InlineData("7", 7)]
    public void Concurrency_falls_back_below_min_and_clamps_above_max(string raw, int expected)
    {
        Assert.Equal(expected, FromEnv(new() { ["MONITORING_PROBE_CONCURRENCY"] = raw }).Concurrency);
    }

    [Theory]
    [InlineData("99", 2000)]  // below min 100 -> fallback
    [InlineData("100", 100)]
    [InlineData("5.5", 2000)] // non-integer -> fallback
    public void Timeout_uses_envInt_semantics(string raw, int expected)
    {
        Assert.Equal(expected, FromEnv(new() { ["MONITORING_PROBE_TIMEOUT_MS"] = raw }).TimeoutMs);
    }
}
