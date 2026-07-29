using System.Reflection;

namespace NodeScope.ArchitectureTests;

/// <summary>
/// Decision 2: a module may reference Platform and Contracts only. Module-to-module references
/// are a compile error, and the layers inside a module only depend inward.
/// </summary>
/// <remarks>
/// These rules cover one specific gap, and it is worth being precise about which, because the
/// build system already covers more than it looks like (all verified 2026-07-20):
///
///   - Illegal *code* never compiles either way. While a reference is absent the types are not
///     visible, so neither boundary can be crossed by accident.
///   - Layer inversion cannot even be enabled. Infrastructure -> Application -> Domain already
///     exists, so Domain -> Infrastructure closes a cycle and fails with MSB4006 during restore.
///     No reference anyone can add makes it legal.
///   - Cross-module is the soft spot. Inventory -> Identity is acyclic, so adding that
///     ProjectReference and using a type across it compiles cleanly.
///
/// Hence this file's job: catch the deliberate .csproj edit. Someone hits "Inventory cannot see
/// Monitoring", adds the reference because it is the fastest route to a green build, and the mesh
/// the migration exists to escape starts reassembling. The compiler cannot see that coming; the
/// layer rules below do not need to, since MSBuild already refuses.
/// </remarks>
public class ModuleBoundaryRules
{
    private static readonly string[] Modules =
        ["Identity", "Inventory", "Monitoring", "Assistant", "Realtime", "Alerting"];

    /// <summary>Persistence and web stacks that must not reach the inner layers.</summary>
    private static readonly string[] OuterLayerOnly =
        ["Microsoft.EntityFrameworkCore", "Npgsql", "Microsoft.AspNetCore"];

    public static TheoryData<string> ModuleNames()
    {
        var data = new TheoryData<string>();
        foreach (var module in Modules)
        {
            data.Add(module);
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(ModuleNames))]
    public void A_module_does_not_reference_another_module(string module)
    {
        var others = Modules.Where(m => m != module).ToArray();

        foreach (var assembly in AssembliesOfModule(module))
        {
            var leaks = References(assembly)
                .Where(r => others.Any(o => r.StartsWith($"NodeScope.Modules.{o}.", StringComparison.Ordinal)))
                .ToList();

            Assert.True(
                leaks.Count == 0,
                $"{assembly.GetName().Name} reaches into another module: {string.Join(", ", leaks)}.\n"
                + "Cross-module needs go through an interface in NodeScope.Platform.Abstractions "
                + "(implemented by the owning module, injected by DI) or an integration event.");
        }
    }

    [Theory]
    [MemberData(nameof(ModuleNames))]
    public void Domain_and_Application_layers_carry_no_persistence_or_web_dependency(string module)
    {
        foreach (var layer in new[] { "Domain", "Application" })
        {
            var assembly = AssembliesOfModule(module)
                .FirstOrDefault(a => a.GetName().Name == $"NodeScope.Modules.{module}.{layer}");

            if (assembly is null)
            {
                continue;
            }

            var leaks = References(assembly)
                .Where(r => OuterLayerOnly.Any(p => r.StartsWith(p, StringComparison.Ordinal)))
                .ToList();

            Assert.True(
                leaks.Count == 0,
                $"{module}.{layer} depends on {string.Join(", ", leaks)}. Persistence and HTTP belong "
                + "in the Infrastructure layer; define a port here and implement it there.");
        }
    }

    [Fact]
    public void Contracts_stays_free_of_server_only_dependencies()
    {
        var contracts = SolutionAssemblies.Production
            .FirstOrDefault(a => a.GetName().Name == "NodeScope.Contracts");

        if (contracts is null)
        {
            return;
        }

        var leaks = References(contracts)
            .Where(r => OuterLayerOnly.Any(p => r.StartsWith(p, StringComparison.Ordinal))
                        || r.StartsWith("NodeScope.", StringComparison.Ordinal))
            .ToList();

        Assert.True(
            leaks.Count == 0,
            $"NodeScope.Contracts depends on {string.Join(", ", leaks)}. It is compiled into the "
            + "NativeAOT agent and the desktop client, so it must reference nothing.");
    }

    private static IEnumerable<Assembly> AssembliesOfModule(string module) =>
        SolutionAssemblies.Production.Where(a =>
            a.GetName().Name!.StartsWith($"NodeScope.Modules.{module}.", StringComparison.Ordinal));

    private static IEnumerable<string> References(Assembly assembly) =>
        assembly.GetReferencedAssemblies().Select(r => r.Name!);
}
