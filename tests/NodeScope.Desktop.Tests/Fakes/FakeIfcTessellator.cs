using NodeScope.Desktop.Api;
using NodeScope.Desktop.Bim;

namespace NodeScope.Desktop.Tests.Fakes;

internal sealed class FakeIfcTessellator : IIfcTessellator
{
    public bool IsSupported { get; set; } = true;

    public Exception? Failure { get; set; }

    public byte[] Geometry { get; set; } = WexBimFixture.CubeA();

    public BimGeoreference? Georeference { get; set; }

    public IReadOnlyList<BuildingModelElementMetadata>? ElementsOverride { get; set; }

    public IReadOnlyList<BuildingModelElementMetadata> Elements
    {
        get
        {
            if (ElementsOverride is not null)
            {
                return ElementsOverride;
            }

            var scene = WexBimReader.Read(Geometry, CancellationToken.None);
            return
            [
                new(
                    scene.Products.Keys.Single(),
                    "0ABCDEFGHIJKLMNOPQRSTU",
                    "IfcWall",
                    "Fixture wall"),
            ];
        }
    }

    public string? LastSourcePath { get; private set; }

    public Task<IfcTessellationResult> TessellateAsync(
        string sourcePath,
        CancellationToken cancellationToken)
    {
        LastSourcePath = sourcePath;
        if (Failure is not null)
        {
            return Task.FromException<IfcTessellationResult>(Failure);
        }

        var scene = WexBimReader.Read(Geometry, cancellationToken);
        return Task.FromResult(new IfcTessellationResult(Geometry, scene, Elements, Georeference));
    }
}
