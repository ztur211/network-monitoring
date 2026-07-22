using System.Net;
using System.Security.Cryptography;
using System.Text;
using NodeScope.Agent;
using Xunit;
using static NodeScope.Agent.Tests.TestData;

namespace NodeScope.Agent.Tests;

public sealed class SelfUpdaterTests : IDisposable
{
    private const string Platform = "test-plat";

    private readonly ECDsa _publisherKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    private readonly List<string> _log = [];
    private readonly string _exePath;
    private readonly byte[] _oldBinary = Encoding.UTF8.GetBytes("old-binary");
    private readonly byte[] _newBinary = Encoding.UTF8.GetBytes("new-binary-payload");

    public SelfUpdaterTests()
    {
        _exePath = TempPath("nodescope-agent");
        File.WriteAllBytes(_exePath, _oldBinary);
    }

    public void Dispose()
    {
        _publisherKey.Dispose();
        foreach (var client in _clients)
        {
            client.Dispose();
        }
    }

    private string PublicPem => _publisherKey.ExportSubjectPublicKeyInfoPem();

    private string Sign(byte[] payload) => Convert.ToBase64String(
        _publisherKey.SignData(payload, HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence));

    private static string Hex(byte[] payload) => Convert.ToHexString(SHA256.HashData(payload));

    private static string ManifestJson(string version, string platform, string file, string sha256, string signature) =>
        $$"""{"version":"{{version}}","binaries":{"{{platform}}":{"file":"{{file}}","sha256":"{{sha256}}","signature":"{{signature}}"}""" + "}}";

    /// <summary>Serves the manifest at /agent/manifest.json and the binary at /agent/{file}.</summary>
    private sealed class RoutingHandler(Func<Uri, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public List<Uri> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request.RequestUri!);
            return Task.FromResult(respond(request.RequestUri!));
        }
    }

    private static HttpResponseMessage Json(string payload) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(payload, Encoding.UTF8, "application/json"),
    };

    private static HttpResponseMessage Bytes(byte[] payload) => new(HttpStatusCode.OK)
    {
        Content = new ByteArrayContent(payload),
    };

    private readonly List<HttpClient> _clients = [];

    private SelfUpdater Updater(HttpMessageHandler handler, string currentVersion = "0.1.0")
    {
        var http = new HttpClient(handler);
        _clients.Add(http);
        return new SelfUpdater(
            http,
            new Uri("http://appliance/agent/manifest.json"),
            currentVersion,
            _exePath,
            Platform,
            PublicPem,
            _log.Add);
    }

    private RoutingHandler ServingUpdate(string version, byte[] binary, string? sha256 = null, string? signature = null)
    {
        var manifest = ManifestJson(
            version, Platform, "nodescope-agent-test-plat", sha256 ?? Hex(binary), signature ?? Sign(binary));
        return new RoutingHandler(uri => uri.AbsolutePath.EndsWith("manifest.json", StringComparison.Ordinal)
            ? Json(manifest)
            : Bytes(binary));
    }

    [Fact]
    public async Task Installs_a_newer_verified_binary_and_keeps_the_old_one()
    {
        using var handler = ServingUpdate("0.2.0", _newBinary);
        var updated = await Updater(handler).CheckOnceAsync(CancellationToken.None);

        Assert.True(updated);
        Assert.Equal(_newBinary, await File.ReadAllBytesAsync(_exePath));
        Assert.Equal(_oldBinary, await File.ReadAllBytesAsync(_exePath + ".old"));
        Assert.Contains(new Uri("http://appliance/agent/nodescope-agent-test-plat"), handler.Requests);
        if (!OperatingSystem.IsWindows())
        {
            Assert.True(File.GetUnixFileMode(_exePath).HasFlag(UnixFileMode.UserExecute));
        }
    }

    [Theory]
    [InlineData("0.1.0")]
    [InlineData("0.0.9")]
    public async Task Skips_versions_that_are_not_strictly_newer(string offered)
    {
        using var handler = ServingUpdate(offered, _newBinary);
        var updated = await Updater(handler).CheckOnceAsync(CancellationToken.None);

        Assert.False(updated);
        Assert.Equal(_oldBinary, await File.ReadAllBytesAsync(_exePath));
        Assert.Single(handler.Requests); // the binary itself was never fetched
    }

    [Fact]
    public async Task Refuses_a_binary_whose_hash_does_not_match_the_manifest()
    {
        // Manifest promises different bytes than the server delivers.
        using var handler = ServingUpdate("0.2.0", _newBinary, sha256: Hex(Encoding.UTF8.GetBytes("promised")));
        var updated = await Updater(handler).CheckOnceAsync(CancellationToken.None);

        Assert.False(updated);
        Assert.Equal(_oldBinary, await File.ReadAllBytesAsync(_exePath));
        Assert.Contains(_log, m => m.Contains("refusing", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Refuses_a_binary_signed_by_a_different_key()
    {
        using var impostor = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var forged = Convert.ToBase64String(
            impostor.SignData(_newBinary, HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence));
        using var handler = ServingUpdate("0.2.0", _newBinary, signature: forged);
        var updated = await Updater(handler).CheckOnceAsync(CancellationToken.None);

        Assert.False(updated);
        Assert.Equal(_oldBinary, await File.ReadAllBytesAsync(_exePath));
        Assert.Contains(_log, m => m.Contains("refusing", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Skips_when_the_manifest_has_no_entry_for_this_platform()
    {
        var manifest = ManifestJson("0.2.0", "other-plat", "f", Hex(_newBinary), Sign(_newBinary));
        using var handler = new RoutingHandler(_ => Json(manifest));
        var updated = await Updater(handler).CheckOnceAsync(CancellationToken.None);

        Assert.False(updated);
        Assert.Contains(_log, m => m.Contains(Platform, StringComparison.Ordinal));
    }

    [Fact]
    public async Task Skips_an_html_response_where_the_manifest_should_be()
    {
        // A misrouted server can answer with the SPA's index.html; the check must shrug it off.
        using var handler = new RoutingHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("<html><body>app</body></html>", Encoding.UTF8, "text/html"),
        });
        var updated = await Updater(handler).CheckOnceAsync(CancellationToken.None);

        Assert.False(updated);
        Assert.Equal(_oldBinary, await File.ReadAllBytesAsync(_exePath));
    }

    [Fact]
    public async Task Skips_malformed_manifest_json()
    {
        using var handler = new RoutingHandler(_ => Json("{not json"));
        Assert.False(await Updater(handler).CheckOnceAsync(CancellationToken.None));
    }

    [Fact]
    public async Task A_404_means_no_update_channel_and_stays_quiet()
    {
        using var handler = new RoutingHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound));
        var updated = await Updater(handler).CheckOnceAsync(CancellationToken.None);

        Assert.False(updated);
        Assert.Empty(_log);
    }

    [Theory]
    [InlineData("http://host:8080/api", "http://host:8080/agent/manifest.json")]
    [InlineData("https://site.example/api", "https://site.example/agent/manifest.json")]
    [InlineData("http://localhost:3000/api", "http://localhost:3000/agent/manifest.json")]
    public void The_manifest_url_is_the_api_origin_plus_the_agent_path(string apiAddress, string expected)
    {
        Assert.Equal(new Uri(expected), SelfUpdater.DeriveManifestUri(apiAddress));
    }

    [Fact]
    public void The_platform_key_matches_the_release_naming_on_linux()
    {
        if (OperatingSystem.IsLinux())
        {
            Assert.Equal("linux-x64", SelfUpdater.PlatformKey());
        }
    }

    [Fact]
    public async Task The_loop_installs_then_cancels_the_daemon_shutdown()
    {
        using var handler = ServingUpdate("0.2.0", _newBinary);
        using var shutdown = new CancellationTokenSource();
        var updated = await Updater(handler)
            .RunLoopAsync(TimeSpan.FromMilliseconds(30), shutdown)
            .WaitAsync(TimeSpan.FromSeconds(10));

        Assert.True(updated);
        Assert.True(shutdown.IsCancellationRequested);
        Assert.Equal(_newBinary, await File.ReadAllBytesAsync(_exePath));
    }

    [Fact]
    public async Task The_loop_exits_false_when_shutdown_arrives_first()
    {
        using var handler = new RoutingHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound));
        using var shutdown = new CancellationTokenSource(TimeSpan.FromMilliseconds(80));
        var updated = await Updater(handler)
            .RunLoopAsync(TimeSpan.FromMilliseconds(20), shutdown)
            .WaitAsync(TimeSpan.FromSeconds(10));

        Assert.False(updated);
        Assert.Equal(_oldBinary, await File.ReadAllBytesAsync(_exePath));
    }
}
