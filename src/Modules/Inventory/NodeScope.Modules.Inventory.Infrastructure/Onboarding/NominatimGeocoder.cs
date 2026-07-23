using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using NodeScope.Modules.Inventory.Application.Onboarding;

namespace NodeScope.Modules.Inventory.Infrastructure.Onboarding;

/// <summary>
/// Address lookup against OpenStreetMap's Nominatim. Failures return null rather than throwing:
/// a missing coordinate must not break the wizard. The one-request-per-1.1s gate is Nominatim's
/// published usage policy, not a performance tweak.
/// </summary>
internal sealed partial class NominatimGeocoder : IGeocoder
{
    private static readonly TimeSpan MinInterval = TimeSpan.FromMilliseconds(1100);

    // Process-wide, because the policy caps requests per client, not per instance - and the
    // typed HttpClient this sits on is created per use.
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static DateTimeOffset lastRequestAt = DateTimeOffset.MinValue;

    private readonly HttpClient _http;
    private readonly ILogger<NominatimGeocoder> _logger;

    public NominatimGeocoder(HttpClient http, IConfiguration configuration, ILogger<NominatimGeocoder> logger)
    {
        _http = http;
        _logger = logger;
        _http.BaseAddress ??= new Uri("https://nominatim.openstreetmap.org/");
        _http.Timeout = TimeSpan.FromSeconds(10);
        _http.DefaultRequestHeaders.UserAgent.ParseAdd(
            configuration["GEOCODING_USER_AGENT"] ?? "NodeScope/1.0");
        _http.DefaultRequestHeaders.Accept.ParseAdd("application/json");
    }

    public async Task<(double Latitude, double Longitude)?> GeocodeAsync(
        string address,
        CancellationToken cancellationToken)
    {
        await ThrottleAsync(cancellationToken);
        var query = $"search?q={Uri.EscapeDataString(address)}&format=json&limit=1";
        try
        {
            var results = await _http.GetFromJsonAsync<IReadOnlyList<NominatimResult>>(query, cancellationToken);
            var first = results is { Count: > 0 } ? results[0] : null;
            if (first is null
                || !double.TryParse(first.Lat, NumberStyles.Float, CultureInfo.InvariantCulture, out var latitude)
                || !double.TryParse(first.Lon, NumberStyles.Float, CultureInfo.InvariantCulture, out var longitude))
            {
                return null;
            }

            return (latitude, longitude);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or NotSupportedException)
        {
            Log.LookupFailed(_logger, exception);
            return null;
        }
    }

    private static async Task ThrottleAsync(CancellationToken cancellationToken)
    {
        await Gate.WaitAsync(cancellationToken);
        try
        {
            var elapsed = DateTimeOffset.UtcNow - lastRequestAt;
            if (elapsed < MinInterval)
            {
                await Task.Delay(MinInterval - elapsed, cancellationToken);
            }

            lastRequestAt = DateTimeOffset.UtcNow;
        }
        finally
        {
            Gate.Release();
        }
    }

    private sealed record NominatimResult(
        [property: JsonPropertyName("lat")] string Lat,
        [property: JsonPropertyName("lon")] string Lon);

    private static partial class Log
    {
        [LoggerMessage(Level = LogLevel.Warning, Message = "Nominatim geocoding request failed")]
        public static partial void LookupFailed(ILogger logger, Exception exception);
    }
}
