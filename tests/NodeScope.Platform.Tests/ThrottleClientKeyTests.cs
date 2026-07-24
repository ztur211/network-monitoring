using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using NodeScope.Platform.Http;
using System.Net;
using Xunit;

namespace NodeScope.Platform.Tests;

/// <summary>
/// TRUST_PROXY parity: the throttle client key is Express's <c>req.ip</c> under
/// <c>trust proxy &lt;hops&gt;</c>. Getting this wrong behind Cloudflare Tunnel would pool
/// every external user onto one edge address and share the strict auth budget between them.
/// </summary>
public sealed class ThrottleClientKeyTests
{
    private static DefaultHttpContext Context(string? forwardedFor, string peer = "10.0.0.9")
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = IPAddress.Parse(peer);
        if (forwardedFor is not null)
        {
            context.Request.Headers["X-Forwarded-For"] = forwardedFor;
        }

        return context;
    }

    [Fact]
    public void One_trusted_hop_takes_the_last_forwarded_entry()
    {
        Assert.Equal("203.0.113.7", Throttling.ClientKey(Context("203.0.113.7"), trustedProxyHops: 1));
        Assert.Equal("198.51.100.2", Throttling.ClientKey(Context("203.0.113.7, 198.51.100.2"), trustedProxyHops: 1));
    }

    [Fact]
    public void Two_trusted_hops_skip_the_edge_address()
    {
        // Cloudflare Tunnel -> Caddy -> API: XFF = [client, cf-edge]; the client is entry ^2.
        Assert.Equal("203.0.113.7", Throttling.ClientKey(Context("203.0.113.7, 172.70.0.1"), trustedProxyHops: 2));
    }

    [Fact]
    public void More_trusted_hops_than_entries_clamps_to_the_leftmost()
    {
        Assert.Equal("203.0.113.7", Throttling.ClientKey(Context("203.0.113.7"), trustedProxyHops: 5));
    }

    [Fact]
    public void Zero_hops_ignores_the_header_and_keys_on_the_peer()
    {
        Assert.Equal("10.0.0.9", Throttling.ClientKey(Context("203.0.113.7"), trustedProxyHops: 0));
    }

    [Fact]
    public void No_header_falls_back_to_the_peer()
    {
        Assert.Equal("10.0.0.9", Throttling.ClientKey(Context(null), trustedProxyHops: 1));
    }

    [Theory]
    [InlineData(null, 1)]
    [InlineData("2", 2)]
    [InlineData("0", 0)]
    [InlineData("false", 0)]
    [InlineData("garbage", 1)]
    public void Options_parse_TRUST_PROXY_like_node(string? raw, int expected)
    {
        var values = new Dictionary<string, string?>(StringComparer.Ordinal);
        if (raw is not null)
        {
            values["TRUST_PROXY"] = raw;
        }

        var configuration = new ConfigurationBuilder().AddInMemoryCollection(values).Build();
        Assert.Equal(expected, ThrottleOptions.FromConfiguration(configuration).TrustedProxyHops);
    }
}
