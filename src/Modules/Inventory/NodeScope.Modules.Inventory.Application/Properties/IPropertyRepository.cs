using System.Text.Json;
using NodeScope.Modules.Inventory.Domain;

namespace NodeScope.Modules.Inventory.Application.Properties;

/// <summary>
/// Property persistence, including the shared tree walks (the Node
/// <c>PropertiesRepository</c> + <c>PropertyTreeRepository</c> pair). Both recursive walks
/// carry the Postgres <c>CYCLE</c> guard and throw <c>PROP_006</c>/500 on a corrupt tree -
/// a wrong answer here widens permission scopes, so it fails closed.
/// </summary>
public interface IPropertyRepository
{
    public Task<PropertyRecord?> FindAsync(
        string organizationId,
        string id,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken);

    public Task<IReadOnlyList<PropertyRecord>> ListAsync(
        string organizationId,
        IReadOnlyCollection<string>? scope,
        CancellationToken cancellationToken);

    /// <summary>Case-insensitive sibling name collision under the same parent.</summary>
    public Task<bool> SiblingNameExistsAsync(
        string organizationId,
        string? parentId,
        string name,
        string? excludeId,
        CancellationToken cancellationToken);

    public Task<PropertyRecord> CreateAsync(NewProperty newProperty, CancellationToken cancellationToken);

    /// <summary>
    /// Atomic conditional update (<c>WHERE version = expected</c>, version bumped); null when
    /// the version no longer matches. <paramref name="fields"/> keys come from
    /// <see cref="PropertyFields.Writable"/>.
    /// </summary>
    public Task<PropertyRecord?> UpdateWithVersionAsync(
        string organizationId,
        string id,
        IReadOnlyDictionary<string, JsonElement> fields,
        int expectedVersion,
        CancellationToken cancellationToken);

    public Task DeleteAsync(string organizationId, string id, CancellationToken cancellationToken);

    /// <summary>The property and every descendant (cycle-guarded downward walk).</summary>
    public Task<IReadOnlyList<string>> SubtreeIdsAsync(
        string organizationId,
        string rootId,
        CancellationToken cancellationToken);

    /// <summary>Self and every ancestor to the root, ordered self -&gt; root (cycle-guarded).</summary>
    public Task<IReadOnlyList<string>> AncestorIdsAsync(
        string organizationId,
        string id,
        CancellationToken cancellationToken);

    /// <summary>Self -&gt; root with type + code, for naming-token resolution.</summary>
    public Task<IReadOnlyList<PropertyTreeNode>> AncestorChainAsync(
        string organizationId,
        string id,
        CancellationToken cancellationToken);

    /// <summary>True when <paramref name="descendantId"/> is at or anywhere under <paramref name="ancestorId"/>.</summary>
    public Task<bool> IsAtOrUnderAsync(
        string organizationId,
        string descendantId,
        string ancestorId,
        CancellationToken cancellationToken);

    /// <summary>Devices placed at any of <paramref name="propertyIds"/>.</summary>
    public Task<IReadOnlyList<PlacedDevice>> DevicesUnderAsync(
        string organizationId,
        IReadOnlyCollection<string> propertyIds,
        CancellationToken cancellationToken);

    public Task<int> CountDevicesUnderAsync(
        string organizationId,
        IReadOnlyCollection<string> propertyIds,
        CancellationToken cancellationToken);

    public Task<int> CountChartersUnderAsync(
        string organizationId,
        IReadOnlyCollection<string> propertyIds,
        CancellationToken cancellationToken);

    public Task<int> CountBuildingModelsUnderAsync(
        string organizationId,
        IReadOnlyCollection<string> propertyIds,
        CancellationToken cancellationToken);

    /// <summary>Team plus direct member assignments rooted at any of <paramref name="propertyIds"/>.</summary>
    public Task<int> CountAssignmentsUnderAsync(
        string organizationId,
        IReadOnlyCollection<string> propertyIds,
        CancellationToken cancellationToken);
}

/// <summary>A node of the Property hierarchy as returned by the tree walks.</summary>
public sealed record PropertyTreeNode(string Id, PropertyType Type, string? Code);

/// <summary>The placement slice of a Device row containment checks need.</summary>
public sealed record PlacedDevice(string Id, string NetworkId, string PropertyId);
