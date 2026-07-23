using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Identity.Application.Users;
using NodeScope.Modules.Identity.Domain;

namespace NodeScope.Modules.Identity.Infrastructure.Persistence;

internal sealed class UserRepository : IUserRepository
{
    private static readonly JsonElement EmptyObject = JsonDocument.Parse("{}").RootElement.Clone();

    private readonly IdentityDbContext _db;

    public UserRepository(IdentityDbContext db)
    {
        _db = db;
    }

    public async Task<UserRecord?> FindAsync(string userId, CancellationToken cancellationToken)
    {
        var row = await _db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == userId, cancellationToken);
        return row is null ? null : ToRecord(row);
    }

    public Task<bool> EmailExistsAsync(string email, string excludeUserId, CancellationToken cancellationToken) =>
        _db.Users.AnyAsync(u => u.Email == email && u.Id != excludeUserId, cancellationToken);

    public async Task<UserRecord?> UpdateProfileAsync(
        string userId,
        string? name,
        string? email,
        CancellationToken cancellationToken)
    {
        var updated = await _db.Users
            .Where(u => u.Id == userId)
            .ExecuteUpdateAsync(
                setters =>
                {
                    setters.SetProperty(u => u.UpdatedAt, DateTime.UtcNow);
                    if (name is not null)
                    {
                        setters.SetProperty(u => u.Name, name);
                    }

                    if (email is not null)
                    {
                        setters.SetProperty(u => u.Email, email);
                    }
                },
                cancellationToken);
        return updated == 0 ? null : await FindAsync(userId, cancellationToken);
    }

    public Task UpdateLocationAsync(
        string userId,
        double latitude,
        double longitude,
        CancellationToken cancellationToken) =>
        _db.Users
            .Where(u => u.Id == userId)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(u => u.HomeLatitude, latitude)
                    .SetProperty(u => u.HomeLongitude, longitude)
                    .SetProperty(u => u.UpdatedAt, DateTime.UtcNow),
                cancellationToken);

    public async Task<JsonElement> GetPreferencesAsync(string userId, CancellationToken cancellationToken)
    {
        var preferences = await _db.Users
            .Where(u => u.Id == userId)
            .Select(u => u.MapPreferences)
            .SingleOrDefaultAsync(cancellationToken);
        return preferences is null ? EmptyObject : preferences.RootElement.Clone();
    }

    public Task SetPreferencesAsync(string userId, JsonElement preferences, CancellationToken cancellationToken)
    {
        var document = JsonDocument.Parse(preferences.GetRawText());
        return _db.Users
            .Where(u => u.Id == userId)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(u => u.MapPreferences, document)
                    .SetProperty(u => u.UpdatedAt, DateTime.UtcNow),
                cancellationToken);
    }

    public async Task<DateTime?> LatestMetricTimeAsync(
        string organizationId,
        string userId,
        CancellationToken cancellationToken) =>
        await _db.DeviceMetrics
            .Where(m => m.OrganizationId == organizationId && m.UserId == userId)
            .OrderByDescending(m => m.Time)
            .Select(m => (DateTime?)m.Time)
            .FirstOrDefaultAsync(cancellationToken);

    private static UserRecord ToRecord(UserRow row) => new(
        row.Id, row.Email, row.Name, IdentityLabels.Of(row.Tier), row.HomeLatitude, row.HomeLongitude, row.CreatedAt);
}
