namespace NodeScope.Platform.Abstractions;

/// <summary>
/// The Inventory-owned, permission-filtered device slice available to the assistant.
/// A null result deliberately makes missing, foreign, and out-of-scope devices identical.
/// </summary>
public interface IAssistantDeviceContextProvider
{
    public Task<AssistantDeviceContext?> FindVisibleAsync(
        OrgMemberContext member,
        string deviceId,
        CancellationToken cancellationToken);
}

/// <summary>
/// Monitoring data for a device already proven visible by
/// <see cref="IAssistantDeviceContextProvider"/>.
/// </summary>
public interface IAssistantTelemetryContextProvider
{
    public Task<AssistantTelemetryContext> GetAsync(
        string organizationId,
        string deviceId,
        CancellationToken cancellationToken);
}

public sealed record AssistantDeviceContext(
    string Id,
    string Name,
    string Category,
    string? IpAddress,
    string? MacAddress,
    int? Floor,
    string? FloorLabel,
    int TotalConnections,
    IReadOnlyList<AssistantDeviceConnection> Connections);

public sealed record AssistantDeviceConnection(string PeerName, string ConnectionType);

public sealed record AssistantTelemetryContext(
    string State,
    double? LatencyMs,
    DateTime? LastCheckAt,
    IReadOnlyList<AssistantMetricContext> Metrics,
    IReadOnlyList<AssistantStatusEventContext> RecentStatusEvents);

public sealed record AssistantMetricContext(
    string Name,
    double Latest,
    double Average,
    double Minimum,
    double Maximum,
    DateTime LastObservedAt);

public sealed record AssistantStatusEventContext(DateTime Time, string State, string? Source);
