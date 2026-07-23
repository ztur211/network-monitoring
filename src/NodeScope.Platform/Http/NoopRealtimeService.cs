using NodeScope.Platform.Abstractions;

namespace NodeScope.Platform.Http;

/// <summary>
/// The stand-in <see cref="IRealtimeService"/> until the Realtime module lands (step 4's
/// interim gap, Decision 21): producers already emit, nothing is delivered. Registered with
/// TryAdd so the Realtime module's implementation replaces it without ceremony.
/// </summary>
internal sealed class NoopRealtimeService : IRealtimeService
{
    public Task EmitScopedAsync(
        string organizationId,
        string? scopePropertyId,
        string eventName,
        object payload,
        CancellationToken cancellationToken) => Task.CompletedTask;

    public Task EmitScopedMultiAsync(
        string organizationId,
        IReadOnlyCollection<string> scopePropertyIds,
        string eventName,
        object payload,
        CancellationToken cancellationToken) => Task.CompletedTask;

    public Task PushToOrgAsync(string organizationId, string eventName, object payload, CancellationToken cancellationToken) =>
        Task.CompletedTask;

    public Task PushToUserAsync(string userId, string eventName, object payload, CancellationToken cancellationToken) =>
        Task.CompletedTask;

    public Task NotifyAccessChangedAsync(string organizationId, string userId, CancellationToken cancellationToken) =>
        Task.CompletedTask;

    public Task RecomputeOnHomeForUserAsync(string userId, CancellationToken cancellationToken) =>
        Task.CompletedTask;

    public Task EvictOrgMemberAsync(string organizationId, string userId, CancellationToken cancellationToken) =>
        Task.CompletedTask;
}
