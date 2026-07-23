using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using NodeScope.Modules.Inventory.Application.Onboarding;
using NodeScope.Modules.Inventory.Infrastructure.Persistence;

namespace NodeScope.Modules.Inventory.Infrastructure.Onboarding;

/// <summary>
/// In-flight wizard state. Node keeps this in Redis with a 24-hour TTL; the appliance is a
/// single node, so an in-process cache has the same observable behaviour (state survives
/// between turns, expires on its own). Revisit with Decision 8, which decides whether Redis
/// stays in the C# stack at all.
/// </summary>
internal sealed class MemoryOnboardingStateStore : IOnboardingStateStore
{
    private static readonly TimeSpan StateTtl = TimeSpan.FromHours(24);
    private static readonly TimeSpan DismissedTtl = TimeSpan.FromDays(30);

    private readonly IMemoryCache _cache;

    public MemoryOnboardingStateStore(IMemoryCache cache)
    {
        _cache = cache;
    }

    public Task<PersistedOnboardingState?> GetAsync(string userId, CancellationToken cancellationToken) =>
        Task.FromResult(_cache.Get<PersistedOnboardingState>(StateKey(userId)));

    public Task SetAsync(string userId, PersistedOnboardingState state, CancellationToken cancellationToken)
    {
        _cache.Set(StateKey(userId), state, StateTtl);
        return Task.CompletedTask;
    }

    public Task ClearAsync(string userId, CancellationToken cancellationToken)
    {
        _cache.Remove(StateKey(userId));
        return Task.CompletedTask;
    }

    public Task MarkDismissedAsync(string userId, CancellationToken cancellationToken)
    {
        _cache.Set($"onboarding:dismissed:{userId}", true, DismissedTtl);
        return Task.CompletedTask;
    }

    private static string StateKey(string userId) => $"onboarding:state:{userId}";
}

/// <summary>The durable completion marker on the <c>User</c> row.</summary>
internal sealed class OnboardingCompletionStore : IOnboardingCompletionStore
{
    private readonly InventoryDbContext _db;

    public OnboardingCompletionStore(InventoryDbContext db)
    {
        _db = db;
    }

    public Task<bool> IsCompleteAsync(string userId, CancellationToken cancellationToken) =>
        _db.Users.AnyAsync(u => u.Id == userId && u.OnboardingCompletedAt != null, cancellationToken);

    public Task MarkCompleteAsync(string userId, CancellationToken cancellationToken) =>
        _db.Users
            .Where(u => u.Id == userId)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(u => u.OnboardingCompletedAt, DateTime.UtcNow),
                cancellationToken);
}
