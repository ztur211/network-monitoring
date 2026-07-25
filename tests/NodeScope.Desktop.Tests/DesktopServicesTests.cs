using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NodeScope.Desktop.Composition;
using NodeScope.Desktop.ViewModels;
using Xunit;

namespace NodeScope.Desktop.Tests;

public class DesktopServicesTests
{
    [Fact]
    public void Composition_root_resolves_the_shell_view_model_and_logging()
    {
        var scratch = Directory.CreateTempSubdirectory("nodescope-desktop-tests-");
        try
        {
            var storage = new DesktopStorage(
                Path.Combine(scratch.FullName, "logs"),
                Path.Combine(scratch.FullName, "settings.json"),
                Path.Combine(scratch.FullName, "vault.json"));
            using (var provider = DesktopServices.BuildProvider(storage))
            {
                Assert.NotNull(provider.GetRequiredService<MainWindowViewModel>());
                Assert.NotNull(provider.GetRequiredService<ILoggerFactory>());
            }
        }
        finally
        {
            scratch.Delete(recursive: true);
        }
    }
}
