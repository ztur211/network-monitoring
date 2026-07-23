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
    /// owner room only, matching the Node gateway's site-less emits). Implementations stamp
    /// the payload's <c>timestamp</c>. Fire-and-forget semantics: failures are logged, never
    /// thrown into the request that produced the event.
    /// </summary>
    public Task EmitScopedAsync(
        string organizationId,
        string? scopePropertyId,
        string eventName,
        object payload,
        CancellationToken cancellationToken);
}
