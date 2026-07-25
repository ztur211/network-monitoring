using NodeScope.Desktop.Api;

namespace NodeScope.Desktop.ViewModels;

/// <summary>
/// The client-side mirror of the server's F3 configure gate, used to enable and
/// disable write affordances honestly: OWNER (and any unscoped ADMIN) configures
/// everything, a scoped ADMIN only properties inside an assigned subtree, a MEMBER
/// nothing. The server stays the authority - this only prevents dead-end clicks.
/// </summary>
internal sealed class ConfigureScope
{
    private readonly AccessSummary _access;
    private readonly Dictionary<string, string?> _parents;

    private ConfigureScope(AccessSummary access, Dictionary<string, string?> parents)
    {
        _access = access;
        _parents = parents;
    }

    public static ConfigureScope Build(AccessSummary access, IReadOnlyList<PropertySummary> properties) => new(
        access,
        properties.ToDictionary(
            property => property.Id,
            property => property.ParentId,
            StringComparer.Ordinal));

    /// <summary>Whether the role can configure at all (OWNER/ADMIN; a MEMBER never writes).</summary>
    public bool CanConfigureAny => _access.CanConfigure;

    /// <summary>Whether this specific property is inside the caller's configure scope.</summary>
    public bool CanConfigureProperty(string propertyId)
    {
        if (!_access.CanConfigure)
        {
            return false;
        }

        if (_access.Unscoped)
        {
            return true;
        }

        // The assigned ids are subtree roots; walk ancestor-or-self until one matches.
        var current = propertyId;
        while (current is not null)
        {
            if (_access.AssignedRootPropertyIds.Contains(current, StringComparer.Ordinal))
            {
                return true;
            }

            current = _parents.GetValueOrDefault(current);
        }

        return false;
    }

    /// <summary>The property picker's choices: only where a create would actually succeed.</summary>
    public IReadOnlyList<PropertySummary> ConfigurableProperties(IReadOnlyList<PropertySummary> properties) =>
        [.. properties.Where(property => CanConfigureProperty(property.Id))];
}
