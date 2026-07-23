namespace NodeScope.ContractTests.Realtime;

/// <summary>
/// Connection helpers for the realtime parity tests. The one non-obvious piece is the
/// readiness barrier: <see cref="IRealtimeClient.ConnectAsync"/> resolves as soon as the
/// socket is connected, but the gateway joins the org/scope rooms asynchronously in its
/// connection handler and only then emits <c>v1:network:onHome:changed</c> to the socket's
/// user room. Waiting for that event proves the rooms are joined, so a mutation triggered
/// afterwards is guaranteed a chance to reach this subscriber - removing the connect/emit
/// race deterministically instead of with a sleep. (This barrier is socket.io/Node-specific
/// and deliberately lives here, not in the transport-agnostic client.)
/// </summary>
internal static class RealtimeScaffold
{
    /// <summary>The per-connection event the gateway emits once a socket has joined its rooms.</summary>
    public const string ReadyEvent = "v1:network:onHome:changed";

    /// <summary>
    /// Connects an authenticated socket and waits for the readiness barrier, returning a
    /// client whose room membership is established. The caller owns it (<c>await using</c>).
    /// </summary>
    public static async Task<IRealtimeClient> ConnectReadyAsync(Auth auth, CancellationToken cancellationToken = default)
    {
        var client = RealtimeTransport.Create();
        await client.ConnectAsync(auth, cancellationToken);
        await client.WaitForEventAsync(ReadyEvent);
        return client;
    }
}
