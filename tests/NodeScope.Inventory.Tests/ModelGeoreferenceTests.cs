using NodeScope.Modules.Inventory.Domain;
using Xunit;

namespace NodeScope.Inventory.Tests;

/// <summary>
/// The model-frame to WGS84 projection behind derived map pins. Assertions use known geodesy
/// figures (metres per degree on the WGS84 ellipsoid) rather than re-running the formula.
/// </summary>
public sealed class ModelGeoreferenceTests
{
    private static ModelGeoreference Reference(
        double rotationDegrees = 0,
        double metersPerUnit = 1,
        double anchorLatitude = 45,
        double anchorLongitude = 8,
        double anchorX = 0,
        double anchorY = 0) =>
        new(anchorLatitude, anchorLongitude, anchorX, anchorY, rotationDegrees, metersPerUnit);

    [Fact]
    public void AnchorProjectsToAnchor()
    {
        var (latitude, longitude) = Reference(anchorX: 12.5, anchorY: -3.25).Project(12.5, -3.25);
        Assert.Equal(45, latitude, 12);
        Assert.Equal(8, longitude, 12);
    }

    [Fact]
    public void NorthOffsetMovesLatitudeOnly()
    {
        // One degree of latitude at 45° is 111.132 km on the WGS84 ellipsoid,
        // so 100 m north is 0.00089983°.
        var (latitude, longitude) = Reference().Project(0, 100);
        Assert.Equal(45.00089983, latitude, 7);
        Assert.Equal(8, longitude, 12);
    }

    [Fact]
    public void EastOffsetMovesLongitudeOnly()
    {
        // One degree of longitude at 45° is 78.847 km, so 100 m east is 0.00126828°.
        var (latitude, longitude) = Reference().Project(100, 0);
        Assert.Equal(45, latitude, 12);
        Assert.Equal(8.00126828, longitude, 7);
    }

    [Fact]
    public void RotationRedirectsModelAxesToCompassAxes()
    {
        // Rotation 90° means true north lies along model +X (IFC TrueNorth (1, 0)).
        var rotated = Reference(rotationDegrees: 90);
        var (northLatitude, northLongitude) = rotated.Project(100, 0);
        Assert.Equal(45.00089983, northLatitude, 7);
        Assert.Equal(8, northLongitude, 9);

        // ...and model +Y then points due west.
        var (westLatitude, westLongitude) = rotated.Project(0, 100);
        Assert.Equal(45, westLatitude, 9);
        Assert.Equal(8 - 0.00126828, westLongitude, 7);
    }

    [Fact]
    public void MillimetreModelsProjectLikeMetreModels()
    {
        var metres = Reference().Project(25, 40);
        var millimetres = Reference(metersPerUnit: 0.001).Project(25_000, 40_000);
        Assert.Equal(metres.Latitude, millimetres.Latitude, 12);
        Assert.Equal(metres.Longitude, millimetres.Longitude, 12);
    }

    [Fact]
    public void AnchorOffsetShiftsTheFrame()
    {
        // The anchor names the model point sitting at the anchor coordinates, so a point
        // 100 m past it lands exactly where a zero-anchor frame puts 100 m.
        var shifted = Reference(anchorX: 500, anchorY: 200).Project(500, 300);
        var unshifted = Reference().Project(0, 100);
        Assert.Equal(unshifted.Latitude, shifted.Latitude, 12);
        Assert.Equal(unshifted.Longitude, shifted.Longitude, 12);
    }

    [Fact]
    public void LongitudeWrapsAcrossTheAntimeridian()
    {
        var (_, longitude) = Reference(anchorLongitude: 179.9999).Project(100, 0);
        Assert.True(longitude is > -180 and < -179.99);
    }

    [Fact]
    public void LatitudeClampsAtThePoles()
    {
        var (latitude, _) = Reference(anchorLatitude: 89.9999).Project(0, 100_000);
        Assert.Equal(90, latitude, 12);
    }
}
