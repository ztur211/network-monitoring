namespace NodeScope.ContractTests.Fixtures;

/// <summary>
/// Which realtime wire the suite speaks. The parity contract is semantic (which event, which
/// payload, which subscriber), so the same tests run against Node's socket.io gateway and the
/// C# host's SignalR hub - this picks the client for the target under test.
/// </summary>
public static class RealtimeTransport
{
    /// <summary>Set to <c>signalr</c> when the target is the C# host.</summary>
    public const string Variable = "NODESCOPE_REALTIME_TRANSPORT";

    /// <summary>Where the C# host serves the hub.</summary>
    public const string HubPath = "/hubs/v1";

    /// <summary>
    /// The server-to-client events the SignalR client subscribes to. SignalR dispatches by
    /// method name with no catch-all, so the catalogue has to be named up front.
    /// </summary>
    public static readonly IReadOnlyList<string> ServerEvents =
    [
        "v1:metrics:update", "v1:device:updated", "v1:device:deleted", "v1:device:status",
        "v1:circuit:updated", "v1:circuit:deleted", "v1:fiber-run:updated", "v1:fiber-run:deleted",
        "v1:connection:updated", "v1:connection:deleted", "v1:ai:token", "v1:ai:complete",
        "v1:network:updated", "v1:network:onHome:changed", "v1:onboarding:turn", "v1:error", "v1:pong",
        "v1:org:updated", "v1:org:member:added", "v1:org:member:updated", "v1:org:member:removed",
        "v1:org:invitation:created", "v1:org:invitation:revoked", "v1:org:invitation:accepted",
        "v1:org:joinRequest:created", "v1:org:joinRequest:decided",
        "v1:property:created", "v1:property:updated", "v1:property:deleted", "v1:property:moved",
        "v1:network:charter:added", "v1:network:charter:removed",
        "v1:team:created", "v1:team:updated", "v1:team:deleted",
        "v1:team:member:added", "v1:team:member:removed",
        "v1:team:property:assigned", "v1:team:property:unassigned",
        "v1:member:property:assigned", "v1:member:property:unassigned", "v1:access:changed",
        "v1:buildingModel:versionUploaded", "v1:buildingModel:activated", "v1:buildingModel:deleted",
        "v1:bcf:topic:created", "v1:bcf:topic:updated", "v1:bcf:comment:added",
    ];

    public static bool UseSignalR =>
        string.Equals(
            Environment.GetEnvironmentVariable(Variable), "signalr", StringComparison.OrdinalIgnoreCase);

    /// <summary>A client-to-server socket.io event mapped to the hub method serving it.</summary>
    public static string ClientMethod(string eventName) => eventName switch
    {
        "v1:ping" => "Ping",
        _ => throw new NotSupportedException($"No hub method is mapped for '{eventName}'."),
    };

    /// <summary>A client for the configured transport, unconnected.</summary>
    public static IRealtimeClient Create() =>
        UseSignalR
            ? new SignalRRealtimeClient(new Uri(TestConfig.BaseUrl))
            : new SocketIoRealtimeClient(new Uri(TestConfig.BaseUrl));
}
