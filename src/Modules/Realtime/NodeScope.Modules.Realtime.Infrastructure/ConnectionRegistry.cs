using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.DependencyInjection;
using NodeScope.Contracts.Realtime;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Realtime.Infrastructure;

/// <summary>
/// The live connections per user. SignalR has no API for enumerating or closing a user's
/// connections, so the hub records them here as they come and go.
/// </summary>
public sealed class ConnectionRegistry : IConnectionRegistry
{
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<string, LiveConnection>> _byUser =
        new(StringComparer.Ordinal);

    private readonly IHubContext<NodeScopeHub> _hub;
    private readonly IServiceScopeFactory _scopes;

    public ConnectionRegistry(IHubContext<NodeScopeHub> hub, IServiceScopeFactory scopes)
    {
        _hub = hub;
        _scopes = scopes;
    }

    public void Add(string userId, string connectionId, string clientIp, HubCallerContext context) =>
        _byUser
            .GetOrAdd(userId, _ => new ConcurrentDictionary<string, LiveConnection>(StringComparer.Ordinal))
            [connectionId] = new LiveConnection(clientIp, context);

    public void Remove(string userId, string connectionId)
    {
        if (_byUser.TryGetValue(userId, out var connections))
        {
            connections.TryRemove(connectionId, out _);
            if (connections.IsEmpty)
            {
                _byUser.TryRemove(userId, out _);
            }
        }
    }

    public async Task RecomputeOnHomeAsync(string userId, CancellationToken cancellationToken)
    {
        if (!_byUser.TryGetValue(userId, out var connections) || connections.IsEmpty)
        {
            return;
        }

        // Each connection is judged on the address it arrived from, so a user connected from
        // home and from elsewhere gets the right answer on each.
        using var scope = _scopes.CreateScope();
        var probe = scope.ServiceProvider.GetRequiredService<IHomeNetworkProbe>();
        foreach (var (connectionId, connection) in connections)
        {
            var status = await probe.CheckAsync(userId, connection.ClientIp, cancellationToken);
            await _hub.Clients.Client(connectionId).SendAsync(
                WsEvents.NetworkOnHomeChanged,
                new { networkId = status.NetworkId, onHome = status.OnHome },
                cancellationToken);
        }
    }

    public Task DisconnectUserAsync(string userId, CancellationToken cancellationToken)
    {
        if (_byUser.TryGetValue(userId, out var connections))
        {
            foreach (var connection in connections.Values)
            {
                connection.Context.Abort();
            }
        }

        return Task.CompletedTask;
    }

    private sealed record LiveConnection(string ClientIp, HubCallerContext Context);
}
