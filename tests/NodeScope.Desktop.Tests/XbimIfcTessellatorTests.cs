using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Bim;
using Xunit;

namespace NodeScope.Desktop.Tests;

public sealed class XbimIfcTessellatorTests
{
    [Fact]
    public async Task Windows_engine_tessellates_the_real_wall_ifc_into_valid_wexbim()
    {
        if (!OperatingSystem.IsWindows())
        {
            Assert.Skip("xBIM's Open Cascade geometry engine only ships Windows native assets.");
            return;
        }

        var sourcePath = FindRepositoryFile(
            "apps",
            "desktop",
            "src",
            "renderer",
            "viewport",
            "ifc",
            "__tests__",
            "fixtures",
            "wall.ifc");
        var tessellator = new XbimIfcTessellator(NullLoggerFactory.Instance);

        var result = await tessellator.TessellateAsync(
            sourcePath,
            TestContext.Current.CancellationToken);

        Assert.True(result.WexBim.Length > 100);
        Assert.Equal(0x05, result.WexBim[0] & 0x0F);
        Assert.Equal(12, result.Scene.TriangleCount);
        Assert.Equal(1, result.Scene.VisibleProductCount);
        Assert.False(result.Scene.Bounds.IsEmpty);
        var element = Assert.Single(result.Elements);
        Assert.Equal(result.Scene.Products.Keys.Single(), element.ProductLabel);
        Assert.Equal(22, element.GlobalId.Length);
        Assert.StartsWith("Ifc", element.TypeName, StringComparison.Ordinal);
    }

    private static string FindRepositoryFile(params string[] segments)
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory);
             directory is not null;
             directory = directory.Parent)
        {
            var candidate = Path.Combine([directory.FullName, .. segments]);
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        throw new FileNotFoundException(
            $"Could not find repository fixture '{Path.Combine(segments)}'.");
    }
}
