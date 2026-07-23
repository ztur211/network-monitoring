using System.Text.Json;
using System.Text.Json.Serialization;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Identity.Application.Users;

/// <summary>User wire DTO (Node's <c>UserDto</c>).</summary>
public sealed record UserDto(
    string Id,
    string Email,
    string? Name,
    string Tier,
    double? HomeLatitude,
    double? HomeLongitude,
    DateTime CreatedAt);

/// <summary>Body of <c>PATCH /api/v1/users/me</c>.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class UpdateMeRequest
{
    public string? Name { get; init; }

    public string? Email { get; init; }

    public string? TrimmedName => Name?.Trim();

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        RequestValidation.MaxLength(errors, TrimmedName, "name", 100);
        if (Email is not null && !IsEmail(Email))
        {
            errors.Add("email must be an email");
        }

        return errors;
    }

    /// <summary>validator.js <c>isEmail</c> in the shape this product needs: one @, no spaces, a dotted host.</summary>
    private static bool IsEmail(string value)
    {
        var at = value.IndexOf('@', StringComparison.Ordinal);
        return at > 0
            && at == value.LastIndexOf('@')
            && at < value.Length - 1
            && !value.Contains(' ', StringComparison.Ordinal)
            && value[(at + 1)..].Contains('.', StringComparison.Ordinal);
    }
}

/// <summary>Body of <c>POST /api/v1/users/location</c>: an address, or a coordinate pair.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class SetLocationRequest
{
    public string? Address { get; init; }

    public double? Latitude { get; init; }

    public double? Longitude { get; init; }

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        if (Latitude is < -90 or > 90)
        {
            errors.Add("latitude must be a latitude string or number");
        }

        if (Longitude is < -180 or > 180)
        {
            errors.Add("longitude must be a longitude string or number");
        }

        return errors;
    }
}

public sealed record LocationDto(double Latitude, double Longitude, string? Address);

/// <summary>One data source and whether it is currently feeding the account.</summary>
public sealed record DataSourceStatusDto(string Type, bool Connected, DateTime? LastSeen, string Message);

public sealed record DataSourcesDto(IReadOnlyList<DataSourceStatusDto> Sources);

/// <summary>Map preferences are free-form client state, stored and returned verbatim.</summary>
public sealed record PreferencesDto(JsonElement Preferences);

/// <summary>User reads and self-service edits (Node's <c>UsersService</c>).</summary>
public sealed class UsersService
{
    /// <summary>Three times the 30s collector interval: a source quiet for longer is not live.</summary>
    private static readonly TimeSpan ConnectedThreshold = TimeSpan.FromSeconds(90);

    private readonly IUserRepository _users;
    private readonly IGeocoder _geocoder;

    public UsersService(IUserRepository users, IGeocoder geocoder)
    {
        _users = users;
        _geocoder = geocoder;
    }

    public async Task<UserDto> GetMeAsync(string userId, CancellationToken cancellationToken) =>
        (await _users.FindAsync(userId, cancellationToken) ?? throw ApiErrors.NotFound()).ToDto();

    public async Task<UserDto> UpdateMeAsync(
        string userId,
        UpdateMeRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.Email is not null
            && await _users.EmailExistsAsync(request.Email, userId, cancellationToken))
        {
            throw IdentityErrors.EmailTaken();
        }

        var updated = await _users.UpdateProfileAsync(
            userId, request.TrimmedName, request.Email, cancellationToken)
            ?? throw ApiErrors.NotFound();
        return updated.ToDto();
    }

    /// <summary>
    /// Sets the user's home coordinates from an address (geocoded) or from an explicit pair.
    /// An address that cannot be resolved is <c>MAP_001</c>, not a silent no-op.
    /// </summary>
    public async Task<LocationDto> SetLocationAsync(
        string userId,
        SetLocationRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (string.IsNullOrEmpty(request.Address) && request.Latitude is null)
        {
            throw new ApiException("GEN_001", "Either address or latitude+longitude must be provided", 400);
        }

        if (!string.IsNullOrEmpty(request.Address))
        {
            var found = await _geocoder.GeocodeAsync(request.Address, cancellationToken)
                ?? throw IdentityErrors.GeocodingFailed();
            await _users.UpdateLocationAsync(userId, found.Latitude, found.Longitude, cancellationToken);
            return new LocationDto(found.Latitude, found.Longitude, found.DisplayName);
        }

        var latitude = request.Latitude!.Value;
        var longitude = request.Longitude ?? 0;
        await _users.UpdateLocationAsync(userId, latitude, longitude, cancellationToken);
        return new LocationDto(latitude, longitude, null);
    }

    public async Task<DataSourcesDto> GetDataSourcesAsync(
        string organizationId,
        string userId,
        CancellationToken cancellationToken)
    {
        var lastSeen = await _users.LatestMetricTimeAsync(organizationId, userId, cancellationToken);
        var connected = lastSeen is not null && DateTime.UtcNow - lastSeen.Value < ConnectedThreshold;
        return new DataSourcesDto(
        [
            new DataSourceStatusDto(
                "browser",
                connected,
                lastSeen,
                connected
                    ? "Browser monitoring active"
                    : "Browser monitoring inactive - open NodeScope to collect data"),
        ]);
    }

    public async Task<PreferencesDto> GetPreferencesAsync(string userId, CancellationToken cancellationToken) =>
        new(await _users.GetPreferencesAsync(userId, cancellationToken));

    public async Task<PreferencesDto> UpdatePreferencesAsync(
        string userId,
        JsonElement preferences,
        CancellationToken cancellationToken)
    {
        await _users.SetPreferencesAsync(userId, preferences, cancellationToken);
        return await GetPreferencesAsync(userId, cancellationToken);
    }
}

/// <summary>A User row as the application layer sees it.</summary>
public sealed record UserRecord(
    string Id,
    string Email,
    string? Name,
    string Tier,
    double? HomeLatitude,
    double? HomeLongitude,
    DateTime CreatedAt)
{
    public UserDto ToDto() => new(Id, Email, Name, Tier, HomeLatitude, HomeLongitude, CreatedAt);
}

/// <summary>User persistence (Node's <c>UsersRepository</c>).</summary>
public interface IUserRepository
{
    public Task<UserRecord?> FindAsync(string userId, CancellationToken cancellationToken);

    /// <summary>True when another user already holds the address.</summary>
    public Task<bool> EmailExistsAsync(string email, string excludeUserId, CancellationToken cancellationToken);

    /// <summary>Absent values leave their column alone.</summary>
    public Task<UserRecord?> UpdateProfileAsync(
        string userId,
        string? name,
        string? email,
        CancellationToken cancellationToken);

    public Task UpdateLocationAsync(
        string userId,
        double latitude,
        double longitude,
        CancellationToken cancellationToken);

    /// <summary>Free-form client state; an unset column reads as an empty object.</summary>
    public Task<JsonElement> GetPreferencesAsync(string userId, CancellationToken cancellationToken);

    public Task SetPreferencesAsync(string userId, JsonElement preferences, CancellationToken cancellationToken);

    /// <summary>When the user's browser collector last reported, if ever.</summary>
    public Task<DateTime?> LatestMetricTimeAsync(
        string organizationId,
        string userId,
        CancellationToken cancellationToken);
}
