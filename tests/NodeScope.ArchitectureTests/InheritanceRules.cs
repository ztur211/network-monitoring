using System.Reflection;

namespace NodeScope.ArchitectureTests;

/// <summary>
/// Decision 6: inheritance for framework integration is fine; inheritance for code reuse is not.
/// </summary>
/// <remarks>
/// Analyzers cannot express this. CA1852 makes types sealed by default, which raises the cost of
/// creating a base class, but nothing stops someone from writing <c>BaseApiController</c> and
/// unsealing everything under it. This rule names the four base classes the stack genuinely
/// requires and rejects the rest.
/// </remarks>
public class InheritanceRules
{
    /// <summary>
    /// Base types a NodeScope type is permitted to inherit from, by full name.
    /// Every entry is framework integration that has no composition-based alternative.
    /// </summary>
    private static readonly HashSet<string> AllowedBaseTypes = new(StringComparer.Ordinal)
    {
        "System.Object",
        "System.ValueType",
        "System.Enum",
        "System.Attribute",
        "System.MulticastDelegate",
        "System.Exception",                                         // domain exceptions
        "Microsoft.EntityFrameworkCore.DbContext",                  // per-module contexts (Decision 5)
        "Microsoft.EntityFrameworkCore.Migrations.Migration",       // tooling-generated
        "Microsoft.AspNetCore.SignalR.Hub",                         // realtime hubs
        "Microsoft.AspNetCore.Authentication.AuthenticationHandler`1", // the session handler (Decision 7)
    };

    [Fact]
    public void No_type_inherits_from_a_base_class_outside_the_allowlist()
    {
        var violations = new List<string>();

        foreach (var assembly in SolutionAssemblies.Production)
        {
            foreach (var type in assembly.GetTypes())
            {
                if (type.BaseType is null || IsCompilerGenerated(type))
                {
                    continue;
                }

                // A NodeScope type inheriting another NodeScope type is the reuse-inheritance
                // this rule exists to stop, so it is never allowlisted - only framework bases are.
                var baseName = Normalize(type.BaseType);
                if (AllowedBaseTypes.Contains(baseName))
                {
                    continue;
                }

                violations.Add($"{type.FullName} inherits {baseName}");
            }
        }

        Assert.True(
            violations.Count == 0,
            "Inheritance is reserved for framework integration (Decision 6). Prefer composition, "
            + "an extension method, or an endpoint filter. If a new framework base class is genuinely "
            + "unavoidable, add it to AllowedBaseTypes with a comment saying why.\n  "
            + string.Join("\n  ", violations));
    }

    private static string Normalize(Type type) =>
        type.IsGenericType ? type.GetGenericTypeDefinition().FullName! : type.FullName!;

    private static bool IsCompilerGenerated(Type type) =>
        type.IsDefined(typeof(System.Runtime.CompilerServices.CompilerGeneratedAttribute), inherit: false)
        || type.Name.Contains('<', StringComparison.Ordinal);
}
