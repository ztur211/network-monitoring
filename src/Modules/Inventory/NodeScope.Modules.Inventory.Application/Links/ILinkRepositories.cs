using System.Text.Json;
using NodeScope.Modules.Inventory.Domain;

namespace NodeScope.Modules.Inventory.Application.Links;

/// <summary>Circuit persistence (Node's <c>CircuitsRepository</c>).</summary>
public interface ICircuitRepository
{
    /// <summary>
    /// One keyset page ordered <c>createdAt DESC, id DESC</c>. A non-null scope keeps only
    /// circuits whose linked device sits in scope, which also hides device-less circuits.
    /// </summary>
    public Task<IReadOnlyList<CircuitRecord>> ListPageAsync(
        string organizationId,
        IReadOnlyCollection<string>? scope,
        int take,
        CircuitCursor? cursor,
        CancellationToken cancellationToken);

    public Task<int> CountAsync(
        string organizationId,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken);

    public Task<CircuitRecord?> FindAsync(
        string organizationId,
        string circuitId,
        CancellationToken cancellationToken);

    public Task<CircuitRecord?> FindVisibleAsync(
        string organizationId,
        string circuitId,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken);

    public Task<CircuitRecord> CreateAsync(NewCircuit circuit, CancellationToken cancellationToken);

    public Task<CircuitRecord?> UpdateWithVersionAsync(
        string organizationId,
        string circuitId,
        IReadOnlyDictionary<string, JsonElement> fields,
        int expectedVersion,
        CancellationToken cancellationToken);

    public Task DeleteAsync(string organizationId, string circuitId, CancellationToken cancellationToken);
}

/// <summary>FiberRun persistence (Node's <c>FiberRunsRepository</c>).</summary>
public interface IFiberRunRepository
{
    /// <summary>
    /// Ordered <c>createdAt DESC</c>. A run is visible when EITHER endpoint device is in scope,
    /// and <paramref name="deviceId"/> filters to runs touching that device.
    /// </summary>
    public Task<IReadOnlyList<FiberRunRecord>> ListVisibleAsync(
        string organizationId,
        IReadOnlyCollection<string>? scope,
        string? deviceId,
        CancellationToken cancellationToken);

    public Task<FiberRunRecord?> FindAsync(
        string organizationId,
        string fiberRunId,
        CancellationToken cancellationToken);

    public Task<FiberRunRecord?> FindVisibleAsync(
        string organizationId,
        string fiberRunId,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken);

    public Task<FiberRunRecord> CreateAsync(NewFiberRun fiberRun, CancellationToken cancellationToken);

    public Task<FiberRunRecord?> UpdateWithVersionAsync(
        string organizationId,
        string fiberRunId,
        IReadOnlyDictionary<string, JsonElement> fields,
        int expectedVersion,
        CancellationToken cancellationToken);

    public Task DeleteAsync(string organizationId, string fiberRunId, CancellationToken cancellationToken);
}

/// <summary>DeviceConnection persistence (Node's <c>ConnectionsRepository</c>).</summary>
public interface IConnectionRepository
{
    /// <summary>Ordered <c>createdAt DESC</c>, same either-endpoint visibility as fiber runs.</summary>
    public Task<IReadOnlyList<ConnectionRecord>> ListVisibleAsync(
        string organizationId,
        IReadOnlyCollection<string>? scope,
        string? deviceId,
        CancellationToken cancellationToken);

    public Task<ConnectionRecord?> FindAsync(
        string organizationId,
        string connectionId,
        CancellationToken cancellationToken);

    public Task<ConnectionRecord?> FindVisibleAsync(
        string organizationId,
        string connectionId,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken);

    /// <summary>Uniqueness is the (source, target, type) triple, not the device pair.</summary>
    public Task<bool> DuplicateExistsAsync(
        string organizationId,
        string sourceDeviceId,
        string targetDeviceId,
        ConnectionType connectionType,
        CancellationToken cancellationToken);

    public Task<ConnectionRecord> CreateAsync(NewConnection connection, CancellationToken cancellationToken);

    public Task<ConnectionRecord?> UpdateWithVersionAsync(
        string organizationId,
        string connectionId,
        IReadOnlyDictionary<string, JsonElement> fields,
        int expectedVersion,
        CancellationToken cancellationToken);

    public Task DeleteAsync(string organizationId, string connectionId, CancellationToken cancellationToken);
}
