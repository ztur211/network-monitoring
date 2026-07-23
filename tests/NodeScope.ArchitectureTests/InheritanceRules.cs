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
        "Microsoft.AspNetCore.Authentication.AuthenticationSchemeOptions", // AddScheme<TOptions,> constrains to this class
        "System.Text.Json.Serialization.JsonSerializerContext",        // source-generated JSON (AOT agent); the generator requires it
        "System.Text.Json.Serialization.JsonConverter`1",              // custom wire formats (JS-style dates); STJ has no composition seam
        "System.IO.Stream",                                            // streaming decorators; the pipeline takes a Stream, not an interface
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
                if (AllowedBaseTypes.Contains(baseName) || IsClosedUnionCase(type))
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

    /// <summary>
    /// A case of a closed union: an abstract record base that declares no state and no
    /// behaviour of its own, with sealed cases beneath it. That is a data shape, not the reuse
    /// inheritance Decision 6 rules out - nothing is inherited, because there is nothing there.
    /// A base that grows a member stops qualifying and the rule fires again, which is the point.
    /// </summary>
    private static bool IsClosedUnionCase(Type type)
    {
        var baseType = type.BaseType!;
        if (!type.IsSealed || !baseType.IsAbstract || !IsRecord(baseType))
        {
            return false;
        }

        const BindingFlags Declared =
            BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.DeclaredOnly;
        return baseType.GetFields(Declared).Length == 0
            && baseType.GetProperties(Declared).All(property => property.Name == "EqualityContract")
            && baseType.GetMethods(Declared).All(IsRecordMember);
    }

    /// <summary>A record has the compiler-generated clone method; nothing else does.</summary>
    private static bool IsRecord(Type type) =>
        type.GetMethod("<Clone>$", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance) is not null;

    /// <summary>The members the record compiler always emits, which carry no author intent.</summary>
    private static bool IsRecordMember(MethodInfo method) =>
        method.Name is "<Clone>$" or "get_EqualityContract" or "Equals" or "GetHashCode" or "ToString"
            or "PrintMembers" or "op_Equality" or "op_Inequality" or "Deconstruct";

    private static string Normalize(Type type) =>
        type.IsGenericType ? type.GetGenericTypeDefinition().FullName! : type.FullName!;

    // FullName (not Name) so that types NESTED inside a generated type are also filtered:
    // [GeneratedRegex] emits <RegexGenerator_g>...+RunnerFactory+Runner, where only the
    // outermost name carries the '<' marker.
    private static bool IsCompilerGenerated(Type type) =>
        type.IsDefined(typeof(System.Runtime.CompilerServices.CompilerGeneratedAttribute), inherit: false)
        || type.FullName?.Contains('<', StringComparison.Ordinal) == true;
}
