using System.Reflection;

namespace NodeScope.ArchitectureTests;

/// <summary>
/// The agent is a standalone NativeAOT deliverable (sequencing step 3): it may reference
/// Contracts and nothing else of ours. A reference onto Platform or a module would weld the
/// shipped binary to server internals - exactly the coupling the Contracts project exists
/// to prevent - and would drag server-only dependencies into the trimmed binary.
/// </summary>
public class AgentBoundaryRules
{
    [Fact]
    public void The_agent_references_only_Contracts_among_NodeScope_assemblies()
    {
        var agent = SolutionAssemblies.Production
            .FirstOrDefault(a => a.GetName().Name == "NodeScope.Agent");
        Assert.NotNull(agent); // referenced by this project; absence means the load went wrong

        var leaks = agent.GetReferencedAssemblies()
            .Select(reference => reference.Name!)
            .Where(name => name.StartsWith("NodeScope.", StringComparison.Ordinal)
                           && name != "NodeScope.Contracts")
            .ToList();

        Assert.True(
            leaks.Count == 0,
            $"NodeScope.Agent references server assemblies: {string.Join(", ", leaks)}.\n"
            + "The agent ships to customer hosts; anything it needs from the server side must "
            + "be a DTO in NodeScope.Contracts.");
    }

    [Fact]
    public void No_server_assembly_references_the_agent()
    {
        foreach (var assembly in SolutionAssemblies.Production)
        {
            if (assembly.GetName().Name == "NodeScope.Agent")
            {
                continue;
            }

            var backReferences = assembly.GetReferencedAssemblies()
                .Where(reference => reference.Name == "NodeScope.Agent")
                .ToList();

            Assert.True(
                backReferences.Count == 0,
                $"{assembly.GetName().Name} references NodeScope.Agent. The agent is a leaf "
                + "deliverable; shared shapes belong in NodeScope.Contracts.");
        }
    }
}
