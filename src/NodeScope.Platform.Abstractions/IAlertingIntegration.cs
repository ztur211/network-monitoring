namespace NodeScope.Platform.Abstractions;

/// <summary>A module-neutral selector for the devices covered by an alert rule.</summary>
public sealed record AlertScopeSelection(
    bool All,
    IReadOnlyList<string> DeviceIds,
    IReadOnlyList<string> NetworkIds,
    IReadOnlyList<string> PropertyIds);

/// <summary>A committed monitoring state transition delivered to interested modules.</summary>
public sealed record MonitoringStatusTransition(
    string OrganizationId,
    string DeviceId,
    string NetworkId,
    string PropertyId,
    string? PreviousState,
    string State,
    double? LatencyMs,
    DateTime At);

/// <summary>
/// A sink invoked after Monitoring commits a state transition. Implementations must be
/// idempotent because monitoring can retry a notification after a transient failure.
/// </summary>
public interface IMonitoringAlertSink
{
    public Task OnStatusChangedAsync(
        MonitoringStatusTransition transition,
        CancellationToken cancellationToken);
}

/// <summary>
/// Inventory's alert-scope seam. Alerting never references Inventory directly, while
/// property-tree coverage and organization ownership remain authoritative in Inventory.
/// </summary>
public interface IAlertInventoryScope
{
    public Task<bool> ContainsAsync(
        string organizationId,
        AlertScopeSelection scope,
        string deviceId,
        string networkId,
        string propertyId,
        CancellationToken cancellationToken);

    /// <summary>Returns null for all devices, otherwise the owned ids selected by the scope.</summary>
    public Task<IReadOnlyList<string>?> ResolveDeviceIdsAsync(
        string organizationId,
        AlertScopeSelection scope,
        CancellationToken cancellationToken);
}
