using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NodeScope.Contracts.Realtime;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Realtime.Infrastructure;

/// <summary>
/// The SignalR implementation of <see cref="IRealtimeService"/>, replacing the no-op the host
/// wires until this module lands. Every emit is fire-and-forget from the producer's point of
/// view: a delivery failure is logged, never thrown into the request that caused it, because a
/// mutation that already committed must not report failure over a notification.
/// </summary>
/// <remarks>
/// A singleton that opens its own scope for the ancestor lookup, rather than a scoped service
/// holding a request's DbContext. Producers emit fire-and-forget on hot paths (ingest does), so
/// the emit routinely outlives the request that started it - and would otherwise reach for a
/// disposed context and vanish into a discarded task.
/// </remarks>
internal sealed partial class SignalRRealtimeService : IRealtimeService
{
    private readonly IHubContext<NodeScopeHub> _hub;
    private readonly IServiceScopeFactory _scopes;
    private readonly IConnectionRegistry _connections;
    private readonly ILogger<SignalRRealtimeService> _logger;

    public SignalRRealtimeService(
        IHubContext<NodeScopeHub> hub,
        IServiceScopeFactory scopes,
        IConnectionRegistry connections,
        ILogger<SignalRRealtimeService> logger)
    {
        _hub = hub;
        _scopes = scopes;
        _connections = connections;
        _logger = logger;
    }

    public Task EmitScopedAsync(
        string organizationId,
        string? scopePropertyId,
        string eventName,
        object payload,
        CancellationToken cancellationToken) =>
        EmitScopedMultiAsync(
            organizationId,
            scopePropertyId is null ? [] : [scopePropertyId],
            eventName,
            payload,
            cancellationToken);

    public async Task EmitScopedMultiAsync(
        string organizationId,
        IReadOnlyCollection<string> scopePropertyIds,
        string eventName,
        object payload,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scopePropertyIds);

        // A subscriber assigned to a site sees everything beneath it, so an event goes to the
        // groups for its governing site AND every ancestor. The owner group always receives it.
        var groups = new HashSet<string>(StringComparer.Ordinal) { RealtimeGroups.Owner(organizationId) };
        foreach (var propertyId in scopePropertyIds)
        {
            foreach (var ancestorId in await AncestorsAsync(organizationId, propertyId, cancellationToken))
            {
                groups.Add(RealtimeGroups.Scope(ancestorId));
            }
        }

        await SendAsync(_hub.Clients.Groups([.. groups]), eventName, payload, cancellationToken);
    }

    public Task PushToOrgAsync(
        string organizationId,
        string eventName,
        object payload,
        CancellationToken cancellationToken) =>
        SendAsync(_hub.Clients.Group(RealtimeGroups.Org(organizationId)), eventName, payload, cancellationToken);

    public Task PushToUserAsync(string userId, string eventName, object payload, CancellationToken cancellationToken) =>
        SendAsync(_hub.Clients.Group(RealtimeGroups.User(userId)), eventName, payload, cancellationToken);

    public Task NotifyAccessChangedAsync(string organizationId, string userId, CancellationToken cancellationToken) =>
        PushToUserAsync(
            userId, WsEvents.AccessChanged, new { organizationId }, cancellationToken);

    public Task RecomputeOnHomeForUserAsync(string userId, CancellationToken cancellationToken) =>
        _connections.RecomputeOnHomeAsync(userId, cancellationToken);

    public Task EvictOrgMemberAsync(string organizationId, string userId, CancellationToken cancellationToken) =>
        _connections.DisconnectUserAsync(userId, cancellationToken);

    /// <summary>
    /// A cyclic property tree makes the ancestor walk fail closed. That is right for an
    /// authorization decision but wrong for a notification, so the event degrades to the owner
    /// group rather than failing the mutation that produced it.
    /// </summary>
    private async Task<IReadOnlyList<string>> AncestorsAsync(
        string organizationId,
        string propertyId,
        CancellationToken cancellationToken)
    {
        try
        {
            using var scope = _scopes.CreateScope();
            var permissions = scope.ServiceProvider.GetRequiredService<IPermissionScopeService>();
            return await permissions.AncestorPropertyIdsAsync(organizationId, propertyId, cancellationToken);
        }
        catch (ApiException exception)
        {
            Log.AncestorLookupFailed(_logger, propertyId, exception);
            return [];
        }
    }

    private async Task SendAsync(
        IClientProxy clients,
        string eventName,
        object payload,
        CancellationToken cancellationToken)
    {
#pragma warning disable CA1031 // A notification must never surface as a failed mutation.
        try
        {
            await clients.SendAsync(eventName, payload, cancellationToken);
        }
        catch (Exception exception)
        {
            Log.EmitFailed(_logger, eventName, exception);
        }
#pragma warning restore CA1031
    }

    private static partial class Log
    {
        [LoggerMessage(Level = LogLevel.Warning, Message = "Realtime emit of {EventName} failed")]
        public static partial void EmitFailed(ILogger logger, string eventName, Exception exception);

        [LoggerMessage(
            Level = LogLevel.Warning,
            Message = "Could not resolve the ancestors of {PropertyId}; the event reaches owners only")]
        public static partial void AncestorLookupFailed(ILogger logger, string propertyId, Exception exception);
    }
}

/// <summary>
/// Tracks which connections a user holds, which SignalR itself does not expose. Two operations
/// need it: forcing a removed member's connections closed, and re-evaluating a user's
/// on-home-network flag from the address their connections came in on.
/// </summary>
public interface IConnectionRegistry
{
    public Task RecomputeOnHomeAsync(string userId, CancellationToken cancellationToken);

    /// <summary>
    /// Closes the user's connections. Disconnect, not an unsubscribe: it is the only action
    /// that also forces the client to re-resolve its membership when it reconnects.
    /// </summary>
    public Task DisconnectUserAsync(string userId, CancellationToken cancellationToken);
}
