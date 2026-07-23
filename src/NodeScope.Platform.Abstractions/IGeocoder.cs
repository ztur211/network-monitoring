namespace NodeScope.Platform.Abstractions;

/// <summary>
/// Address-to-coordinate lookup. Cross-cutting rather than module-owned: the onboarding wizard
/// and the user's home location both resolve addresses, and both must survive a failed lookup.
/// </summary>
public interface IGeocoder
{
    /// <summary>Coordinates for the address, or null when the lookup fails or finds nothing.</summary>
    public Task<GeocodedAddress?> GeocodeAsync(string address, CancellationToken cancellationToken);
}

/// <summary>A resolved address; <c>DisplayName</c> is the provider's canonical rendering.</summary>
public sealed record GeocodedAddress(double Latitude, double Longitude, string? DisplayName);
