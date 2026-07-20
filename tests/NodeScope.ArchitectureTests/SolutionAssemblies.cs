using System.Reflection;

namespace NodeScope.ArchitectureTests;

/// <summary>
/// Loads the solution's own assemblies off disk for the architecture rules to inspect.
/// </summary>
/// <remarks>
/// Loading by filename rather than by a type anchor (<c>typeof(SomeMarker).Assembly</c>) is
/// deliberate. Anchoring needs every project to contain at least one type, which is false for
/// a freshly scaffolded module and would make these rules silently skip the assemblies that
/// have not been ported yet - exactly the ones most likely to drift. Filename loading covers
/// every project from the moment it exists.
/// </remarks>
internal static class SolutionAssemblies
{
    private static readonly Lazy<List<Assembly>> Loaded = new(Load);

    /// <summary>Every NodeScope assembly present in the test output directory.</summary>
    public static IReadOnlyList<Assembly> All => Loaded.Value;

    /// <summary>Production assemblies only - the test assemblies are not subject to the rules.</summary>
    public static IReadOnlyList<Assembly> Production =>
        All.Where(a => !a.GetName().Name!.Contains("Tests", StringComparison.Ordinal)).ToList();

    private static List<Assembly> Load()
    {
        var directory = Path.GetDirectoryName(typeof(SolutionAssemblies).Assembly.Location)!;
        var assemblies = new List<Assembly>();

        foreach (var path in Directory.EnumerateFiles(directory, "NodeScope.*.dll"))
        {
            try
            {
                assemblies.Add(Assembly.LoadFrom(path));
            }
            catch (BadImageFormatException)
            {
                // Native or mixed-mode artifact that happens to match the pattern; not ours to check.
            }
        }

        Assert.NotEmpty(assemblies);
        return assemblies;
    }
}
