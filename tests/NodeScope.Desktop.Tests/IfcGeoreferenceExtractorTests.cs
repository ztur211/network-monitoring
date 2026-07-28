using System.Numerics;
using NodeScope.Desktop.Bim;
using Xbim.Ifc;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// The import-time georeference extraction, against a hand-written IFC4 fixture. Parsing is
/// pure managed xBIM (no geometry engine), so unlike tessellation this runs on every platform.
/// The fixture: millimetre units, RefLatitude (49,6,0,0) = 49.1°, RefLongitude (8,26,24,0)
/// = 8.44°, TrueNorth (1,0) = +X, and the site placed at local (1000, 2000, 0) under a parent
/// frame rotated 90° CCW about Z - so the site's world origin is (-2000, 1000, 0), proving
/// the walk applies ancestor rotations to child translations rather than just summing them.
/// </summary>
public sealed class IfcGeoreferenceExtractorTests
{
    private static string FixturePath =>
        Path.Combine(AppContext.BaseDirectory, "Fixtures", "georeferenced-site.ifc");

    [Fact]
    public void Extracts_site_georeference_in_the_scene_frame()
    {
        using var model = IfcStore.Open(FixturePath);

        var georeference = IfcGeoreferenceExtractor.Extract(model, Vector3.Zero);

        Assert.NotNull(georeference);
        Assert.Equal(49.1, georeference!.AnchorLatitude, 9);
        Assert.Equal(8.44, georeference.AnchorLongitude, 9);
        Assert.Equal(-2000, georeference.AnchorX, 6);
        Assert.Equal(1000, georeference.AnchorY, 6);
        Assert.Equal(90, georeference.RotationDegrees, 9);
        Assert.Equal(0.001, georeference.MetersPerUnit, 12);
    }

    [Fact]
    public void Subtracts_the_wexbim_world_coordinate_system_offset()
    {
        using var model = IfcStore.Open(FixturePath);

        var georeference = IfcGeoreferenceExtractor.Extract(model, new Vector3(100, 50, 0));

        Assert.NotNull(georeference);
        Assert.Equal(-2100, georeference!.AnchorX, 6);
        Assert.Equal(950, georeference.AnchorY, 6);
    }

    [Fact]
    public void A_model_without_site_coordinates_yields_no_georeference()
    {
        using var model = IfcStore.Open(
            Path.Combine(AppContext.BaseDirectory, "Fixtures", "wall.ifc"));

        Assert.Null(IfcGeoreferenceExtractor.Extract(model, Vector3.Zero));
    }
}
