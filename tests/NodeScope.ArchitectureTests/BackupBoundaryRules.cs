using System.Reflection;

namespace NodeScope.ArchitectureTests;

/// <summary>
/// The backup CLI is a standalone recovery deliverable. It must remain independent
/// from the running API and its modules so recovery does not require server internals.
/// </summary>
public class BackupBoundaryRules
{
    [Fact]
    public void The_backup_cli_references_no_other_NodeScope_assembly()
    {
        var backup = SolutionAssemblies.Production
            .FirstOrDefault(assembly => assembly.GetName().Name == "NodeScope.Backup");
        Assert.NotNull(backup);

        var leaks = backup.GetReferencedAssemblies()
            .Select(reference => reference.Name!)
            .Where(name => name.StartsWith("NodeScope.", StringComparison.Ordinal))
            .ToList();

        Assert.True(
            leaks.Count == 0,
            $"NodeScope.Backup references product assemblies: {string.Join(", ", leaks)}.\n"
            + "Recovery must stay independent from the API and module implementation graph.");
    }

    [Fact]
    public void No_other_NodeScope_assembly_references_the_backup_cli()
    {
        foreach (var assembly in SolutionAssemblies.Production)
        {
            if (assembly.GetName().Name == "NodeScope.Backup")
            {
                continue;
            }

            var backReferences = assembly.GetReferencedAssemblies()
                .Where(reference => reference.Name == "NodeScope.Backup")
                .ToList();

            Assert.True(
                backReferences.Count == 0,
                $"{assembly.GetName().Name} references NodeScope.Backup. The recovery CLI is a leaf deliverable.");
        }
    }
}
