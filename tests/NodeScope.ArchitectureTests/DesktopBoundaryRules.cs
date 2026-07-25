using System.Reflection;

namespace NodeScope.ArchitectureTests;

/// <summary>
/// The desktop client is a standalone deliverable (sequencing step 5): like the agent, it
/// may reference Contracts and nothing else of ours. It talks to the appliance over HTTP
/// and SignalR; a reference onto Platform or a module would weld the shipped client to
/// server internals and drag server-only dependencies into the install.
/// </summary>
public class DesktopBoundaryRules
{
    [Fact]
    public void The_desktop_client_references_only_Contracts_among_NodeScope_assemblies()
    {
        var desktop = SolutionAssemblies.Production
            .FirstOrDefault(a => a.GetName().Name == "NodeScope.Desktop");
        Assert.NotNull(desktop); // referenced by this project; absence means the load went wrong

        var leaks = desktop.GetReferencedAssemblies()
            .Select(reference => reference.Name!)
            .Where(name => name.StartsWith("NodeScope.", StringComparison.Ordinal)
                           && name != "NodeScope.Contracts")
            .ToList();

        Assert.True(
            leaks.Count == 0,
            $"NodeScope.Desktop references server assemblies: {string.Join(", ", leaks)}.\n"
            + "The client ships to operator machines; anything it needs from the server side "
            + "must be a DTO in NodeScope.Contracts.");
    }

    [Fact]
    public void No_server_assembly_references_the_desktop_client()
    {
        foreach (var assembly in SolutionAssemblies.Production)
        {
            if (assembly.GetName().Name == "NodeScope.Desktop")
            {
                continue;
            }

            var backReferences = assembly.GetReferencedAssemblies()
                .Where(reference => reference.Name == "NodeScope.Desktop")
                .ToList();

            Assert.True(
                backReferences.Count == 0,
                $"{assembly.GetName().Name} references NodeScope.Desktop. The client is a leaf "
                + "deliverable; shared shapes belong in NodeScope.Contracts.");
        }
    }
}
