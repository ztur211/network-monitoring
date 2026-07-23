using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Domain;

/// <summary>The hierarchy rules from Node's <c>property-nesting.ts</c> (spec §5).</summary>
public static class PropertyNesting
{
    private static readonly Dictionary<PropertyType, PropertyType[]> AllowedChildren = new()
    {
        [PropertyType.Site] = [PropertyType.Site, PropertyType.Building, PropertyType.Area],
        [PropertyType.Building] = [PropertyType.Floor, PropertyType.Area],
        [PropertyType.Floor] = [PropertyType.Area],
        [PropertyType.Area] = [PropertyType.Area],
    };

    /// <summary>
    /// Throws <c>PROP_002</c> when <paramref name="childType"/> may not sit under
    /// <paramref name="parentType"/> (null parent = root, which must be a SITE).
    /// </summary>
    public static void AssertValidNesting(PropertyType? parentType, PropertyType childType)
    {
        if (parentType is null)
        {
            if (childType != PropertyType.Site)
            {
                throw InvalidParentType();
            }

            return;
        }

        if (!AllowedChildren[parentType.Value].Contains(childType))
        {
            throw InvalidParentType();
        }
    }

    private static ApiException InvalidParentType() => new("PROP_002", "INVALID_PARENT_TYPE", 422);
}
