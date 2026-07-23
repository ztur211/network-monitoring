using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using NodeScope.Contracts.Realtime;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Realtime.Infrastructure;

/// <summary>
/// The realtime hub (Decision 8: SignalR, the first-party option, whose groups map one-to-one
/// onto the socket.io rooms the Node gateway used). Inheriting <see cref="Hub"/> is framework
/// integration, which Decision 6 permits.
/// </summary>
/// <remarks>
/// No backplane: the appliance is a single node by the local-first design, so groups live in
/// process. A multi-node deployment (an MSP aggregating sites) would add
/// <c>Microsoft.AspNetCore.SignalR.StackExchangeRedis</c> and nothing else.
/// </remarks>
[Authorize]
public sealed class NodeScopeHub : Hub
{
    private readonly IOrgMembershipResolver _members;
    private readonly IPermissionScopeService _permissions;
    private readonly IHomeNetworkProbe _homeNetwork;
    private readonly ConnectionRegistry _connections;

    public NodeScopeHub(
        IOrgMembershipResolver members,
        IPermissionScopeService permissions,
        IHomeNetworkProbe homeNetwork,
        ConnectionRegistry connections)
    {
        _members = members;
        _permissions = permissions;
        _homeNetwork = homeNetwork;
        _connections = connections;
    }

    public override async Task OnConnectedAsync()
    {
        var userId = Context.User?.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId is null)
        {
            Context.Abort();
            return;
        }

        _connections.Add(userId, Context.ConnectionId, ClientIp(), Context);
        await Groups.AddToGroupAsync(Context.ConnectionId, RealtimeGroups.User(userId));
        // Resolved here rather than read from the request-scoped org context: authentication
        // ran on the negotiate request, whose scope is long gone by the time a hub callback
        // runs in its own.
        var member = await _members.ForUserAsync(userId, Context.ConnectionAborted);
        if (member is not null)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, RealtimeGroups.Org(member.OrganizationId));
            await SubscribeScopeAsync(member);
        }

        // The last thing the connection does, and deliberately so: a client that has seen this
        // event knows every group join has completed, which is what makes "connect then mutate"
        // race-free without a sleep.
        var onHome = await _homeNetwork.CheckAsync(userId, ClientIp(), Context.ConnectionAborted);
        await Clients.Caller.SendAsync(
            WsEvents.NetworkOnHomeChanged,
            new { networkId = onHome.NetworkId, onHome = onHome.OnHome },
            Context.ConnectionAborted);
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        if (Context.User?.FindFirstValue(ClaimTypes.NameIdentifier) is { } userId)
        {
            _connections.Remove(userId, Context.ConnectionId);
        }

        return base.OnDisconnectedAsync(exception);
    }

    /// <summary>
    /// Liveness check, answered directly to the caller like the Node gateway's ping. The pong
    /// carries a null body, which is what the socket.io gateway sent.
    /// </summary>
    public Task Ping() =>
        Clients.Caller.SendAsync(WsEvents.Pong, (object?)null, Context.ConnectionAborted);

    /// <summary>
    /// Subscribes the connection to the groups mirroring its permission scope, so a scoped
    /// event addresses groups instead of filtering every connection in the org. An OWNER joins
    /// the owner group; a scoped member joins one group per assigned root; a member with no
    /// grants joins none.
    /// </summary>
    private async Task SubscribeScopeAsync(OrgMemberContext member)
    {
        var roots = await _permissions.EffectiveRootPropertyIdsAsync(member, Context.ConnectionAborted);
        if (roots is null)
        {
            await Groups.AddToGroupAsync(
                Context.ConnectionId, RealtimeGroups.Owner(member.OrganizationId), Context.ConnectionAborted);
            return;
        }

        foreach (var rootId in roots)
        {
            await Groups.AddToGroupAsync(
                Context.ConnectionId, RealtimeGroups.Scope(rootId), Context.ConnectionAborted);
        }
    }

    private string ClientIp() =>
        Context.GetHttpContext()?.Connection.RemoteIpAddress?.ToString() ?? "";
}

/// <summary>
/// The group names, which are the socket.io room names verbatim. Property ids are globally
/// unique, so a <c>scope:</c> group can never collide across organizations - that is what
/// makes cross-org isolation structural rather than a filter someone can forget.
/// </summary>
public static class RealtimeGroups
{
    public static string User(string userId) => $"user:{userId}";

    public static string Org(string organizationId) => $"org:{organizationId}";

    public static string Owner(string organizationId) => $"owner:{organizationId}";

    public static string Scope(string rootPropertyId) => $"scope:{rootPropertyId}";
}
