using Microsoft.Extensions.Configuration;
using NodeScope.Platform.Http;
using Xunit;

namespace NodeScope.Platform.Tests;

/// <summary>A hand-cranked clock so window math is tested without real sleeps.</summary>
internal sealed class ManualTime : TimeProvider
{
    private DateTimeOffset _now = new(2026, 7, 24, 12, 0, 0, TimeSpan.Zero);

    public override DateTimeOffset GetUtcNow() => _now;

    public void Advance(TimeSpan by) => _now += by;
}

public sealed class ThrottleStoreTests
{
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(1);

    private static (ThrottleStore Store, ManualTime Clock) NewStore()
    {
        var clock = new ManualTime();
        return (new ThrottleStore(clock), clock);
    }

    [Fact]
    public void Admits_limit_requests_then_blocks_the_next_for_the_block_duration()
    {
        var (store, _) = NewStore();

        for (var i = 1; i <= 3; i++)
        {
            var ok = store.Hit("k", limit: 3, Ttl, Ttl);
            Assert.False(ok.IsBlocked);
            Assert.Equal(i, ok.TotalHits);
        }

        var blocked = store.Hit("k", limit: 3, Ttl, Ttl);
        Assert.True(blocked.IsBlocked);
        // The block lasts blockDuration (= ttl here), reported in whole seconds.
        Assert.Equal(60, blocked.TimeToBlockExpireSeconds);
    }

    [Fact]
    public void Blocked_requests_do_not_extend_the_block()
    {
        var (store, clock) = NewStore();
        for (var i = 0; i < 4; i++)
        {
            store.Hit("k", limit: 3, Ttl, Ttl);
        }

        clock.Advance(TimeSpan.FromSeconds(30));
        var stillBlocked = store.Hit("k", limit: 3, Ttl, Ttl);
        Assert.True(stillBlocked.IsBlocked);
        // 30s into a 60s block: half remains, regardless of the hammering.
        Assert.Equal(30, stillBlocked.TimeToBlockExpireSeconds);
    }

    [Fact]
    public void Block_expiry_resets_the_window_and_counts_the_current_request_as_the_first_hit()
    {
        var (store, clock) = NewStore();
        for (var i = 0; i < 4; i++)
        {
            store.Hit("k", limit: 3, Ttl, Ttl);
        }

        clock.Advance(TimeSpan.FromSeconds(61));
        var fresh = store.Hit("k", limit: 3, Ttl, Ttl);
        Assert.False(fresh.IsBlocked);
        Assert.Equal(1, fresh.TotalHits);
    }

    [Fact]
    public void Hits_decay_individually_so_paced_traffic_never_blocks()
    {
        var (store, clock) = NewStore();

        // 3 hits, then wait out their ttl: capacity fully returns (sliding decay, not a
        // fixed window that would still count them until a boundary).
        for (var i = 0; i < 3; i++)
        {
            store.Hit("k", limit: 3, Ttl, Ttl);
        }

        clock.Advance(TimeSpan.FromSeconds(61));
        var after = store.Hit("k", limit: 3, Ttl, Ttl);
        Assert.False(after.IsBlocked);
        Assert.Equal(1, after.TotalHits);
    }

    [Fact]
    public void Partial_decay_frees_exactly_the_expired_hits()
    {
        var (store, clock) = NewStore();
        store.Hit("k", limit: 3, Ttl, Ttl);              // t=0
        clock.Advance(TimeSpan.FromSeconds(30));
        store.Hit("k", limit: 3, Ttl, Ttl);              // t=30
        clock.Advance(TimeSpan.FromSeconds(31));         // t=61: first hit expired, second alive

        var result = store.Hit("k", limit: 3, Ttl, Ttl);
        Assert.Equal(2, result.TotalHits);
        Assert.False(result.IsBlocked);
    }

    [Fact]
    public void Keys_are_isolated_including_across_a_block_reset()
    {
        var (store, clock) = NewStore();
        store.Hit("other", limit: 3, Ttl, Ttl);
        for (var i = 0; i < 4; i++)
        {
            store.Hit("k", limit: 3, Ttl, Ttl);          // blocks "k"
        }

        // The upstream library bug this store deliberately does NOT reproduce: resetting one
        // key's block cancelled every key's pending decrements. "other"'s hit must still
        // decay on its own schedule.
        clock.Advance(TimeSpan.FromSeconds(61));
        store.Hit("k", limit: 3, Ttl, Ttl);              // block expires, resets "k"
        var other = store.Hit("other", limit: 3, Ttl, Ttl);
        Assert.Equal(1, other.TotalHits);
        Assert.False(other.IsBlocked);
    }

    [Fact]
    public void Reset_header_window_renews_when_it_lapses()
    {
        var (store, clock) = NewStore();
        var first = store.Hit("k", limit: 10, Ttl, Ttl);
        Assert.Equal(60, first.TimeToExpireSeconds);

        clock.Advance(TimeSpan.FromSeconds(45));
        var second = store.Hit("k", limit: 10, Ttl, Ttl);
        Assert.Equal(15, second.TimeToExpireSeconds);

        clock.Advance(TimeSpan.FromSeconds(20));         // past the marker: renews to full ttl
        var third = store.Hit("k", limit: 10, Ttl, Ttl);
        Assert.Equal(60, third.TimeToExpireSeconds);
    }
}

public sealed class ThrottleOptionsTests
{
    private static ThrottleOptions FromEnv(params (string Key, string Value)[] pairs) =>
        ThrottleOptions.FromConfiguration(new ConfigurationBuilder()
            .AddInMemoryCollection(pairs.ToDictionary(p => p.Key, p => (string?)p.Value))
            .Build());

    [Fact]
    public void Production_limits_are_fixed_and_ignore_the_env_overrides()
    {
        var options = FromEnv(
            ("NODE_ENV", "production"),
            ("THROTTLE_DEFAULT_LIMIT", "99999"),
            ("THROTTLE_AUTH_LIMIT", "99999"));
        Assert.Equal(100, options.Buckets.Single(b => b.Name == "default").Limit);
        Assert.Equal(5, options.Buckets.Single(b => b.Name == "auth").Limit);
    }

    [Fact]
    public void Dev_defaults_match_node()
    {
        var options = FromEnv();
        var byName = options.Buckets.ToDictionary(b => b.Name);
        Assert.Equal(2000, byName["default"].Limit);
        Assert.Equal(TimeSpan.FromMinutes(1), byName["default"].Ttl);
        Assert.Equal(200, byName["auth"].Limit);
        Assert.Equal(TimeSpan.FromMinutes(15), byName["auth"].Ttl);
    }

    [Fact]
    public void Dev_overrides_apply_and_invalid_values_fall_back()
    {
        var options = FromEnv(("THROTTLE_DEFAULT_LIMIT", "100000"), ("THROTTLE_AUTH_LIMIT", "abc"));
        Assert.Equal(100_000, options.Buckets.Single(b => b.Name == "default").Limit);
        Assert.Equal(200, options.Buckets.Single(b => b.Name == "auth").Limit);
    }

    [Fact]
    public void Bucket_order_is_default_then_auth_like_the_node_config()
    {
        Assert.Equal(["default", "auth"], FromEnv().Buckets.Select(b => b.Name));
    }
}
