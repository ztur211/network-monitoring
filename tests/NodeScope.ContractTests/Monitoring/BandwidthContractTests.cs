namespace NodeScope.ContractTests.Monitoring;

/// <summary>
/// Contract for /api/bandwidth/echo - the browser collector's bandwidth probe.
/// Both verbs are public (no session) and unthrottled. GET serves a fixed
/// 1,000,000-byte octet-stream payload with Cache-Control: no-store so a
/// measurement can never come from cache; POST drains an arbitrary body and
/// answers 204. Neither speaks the JSON envelope - this is a raw-wire surface.
/// </summary>
[Collection(ContractSuite.Name)]
public class BandwidthContractTests
{
    private const int PayloadBytes = 1_000_000;

    private readonly ApiClient _api;

    public BandwidthContractTests(ContractApiFixture fixture) => _api = fixture.Api;

    [Fact]
    public async Task Download_serves_the_fixed_payload_uncached_without_auth()
    {
        var response = await _api.GetRawAsync("bandwidth/echo");

        Assert.Equal(HttpStatusCode.OK, response.Status);
        Assert.Equal(PayloadBytes, response.Body.Count);
        Assert.Contains("application/octet-stream", response.Header("Content-Type"), StringComparison.Ordinal);
        Assert.Equal(PayloadBytes.ToString(System.Globalization.CultureInfo.InvariantCulture), response.Header("Content-Length"));
        Assert.Contains("no-store", response.Header("Cache-Control"), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Download_payload_is_incompressible_random_bytes()
    {
        // The payload is random precisely so compression middleware can never
        // shrink it on the wire and turn a bandwidth probe into a latency probe.
        // A quick distinct-byte count separates random data from any constant or
        // repetitive filler without asserting the exact bytes.
        var response = await _api.GetRawAsync("bandwidth/echo");

        Assert.Equal(HttpStatusCode.OK, response.Status);
        var distinct = response.Body.Distinct().Count();
        Assert.True(distinct > 200, $"payload has only {distinct} distinct byte values - not random data");
    }

    [Fact]
    public async Task Upload_drains_a_large_body_and_answers_204_without_auth()
    {
        var payload = new byte[PayloadBytes];
        System.Security.Cryptography.RandomNumberGenerator.Fill(payload);

        var response = await _api.PostRawAsync("bandwidth/echo", payload);

        Assert.Equal(HttpStatusCode.NoContent, response.Status);
        Assert.Equal(string.Empty, response.Body);
    }

    [Fact]
    public async Task Upload_answers_204_for_an_empty_body()
    {
        var response = await _api.PostRawAsync("bandwidth/echo", []);

        Assert.Equal(HttpStatusCode.NoContent, response.Status);
    }
}
