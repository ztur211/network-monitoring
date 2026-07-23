namespace NodeScope.Platform.Abstractions;

/// <summary>
/// Scoped realtime fan-out, the neutral abstraction that replaces the Node API's
/// <c>moduleRef.get(REALTIME_SERVICE)</c> service-locator hack (Decision 2). The Realtime
/// module implements it over SignalR; until that module lands the host wires a no-op, so
/// producers (e.g. Monitoring's device-status emit) can already call it.
/// </summary>
public interface IRealtimeService
{
    /// <summary>
    /// Emits <paramref name="eventName"/> to the org's owner room and to every subscriber
    /// whose permission scope covers <paramref name="scopePropertyId"/> (null targets the
    /// owner room only, matching the Node gateway's site-less emits). Callers own the full
    /// payload, timestamps included - the two Node emit layers differ on whether one is
    /// present, so nothing may be stamped here. Fire-and-forget semantics: failures are
    /// logged, never thrown into the request that produced the event.
    /// </summary>
    public Task EmitScopedAsync(
        string organizationId,
        string? scopePropertyId,
        string eventName,
        object payload,
        CancellationToken cancellationToken);

    /// <summary>As <see cref="EmitScopedAsync"/> over several governing sites, deduped (an empty list = owner room only).</summary>
    public Task EmitScopedMultiAsync(
        string organizationId,
        IReadOnlyCollection<string> scopePropertyIds,
        string eventName,
        object payload,
        CancellationToken cancellationToken);

    /// <summary>Emits to every socket in the org room (all members, unscoped).</summary>
    public Task PushToOrgAsync(string organizationId, string eventName, object payload, CancellationToken cancellationToken);

    /// <summary>Emits to the user's own room (all of their sockets).</summary>
    public Task PushToUserAsync(string userId, string eventName, object payload, CancellationToken cancellationToken);

    /// <summary>Tells the affected user's sockets their permission scope changed (<c>v1:access:changed</c>).</summary>
    public Task NotifyAccessChangedAsync(string organizationId, string userId, CancellationToken cancellationToken);

    /// <summary>Re-evaluates the user's on-home-network flag and pushes <c>v1:network:onHome:changed</c>.</summary>
    public Task RecomputeOnHomeForUserAsync(string userId, CancellationToken cancellationToken);

    /// <summary>
    /// Force-disconnects every live socket the user holds for the org, so a removed member
    /// cannot keep receiving its broadcasts under stale membership state.
    /// </summary>
    public Task EvictOrgMemberAsync(string organizationId, string userId, CancellationToken cancellationToken);
}
