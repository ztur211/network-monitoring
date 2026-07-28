using NodeScope.Modules.Inventory.Application.BuildingModels;
using Xunit;

namespace NodeScope.Inventory.Tests;

/// <summary>The all-or-nothing wire validation of the georeference PUT body.</summary>
public sealed class SetGeoreferenceRequestTests
{
    private static SetGeoreferenceRequest Complete(
        double anchorLatitude = 49.1,
        double anchorLongitude = 8.44,
        double rotationDegrees = 0,
        double metersPerUnit = 1) => new()
        {
            AnchorLatitude = anchorLatitude,
            AnchorLongitude = anchorLongitude,
            AnchorX = 0,
            AnchorY = 0,
            RotationDegrees = rotationDegrees,
            MetersPerUnit = metersPerUnit,
        };

    [Fact]
    public void AllNullsIsAValidClear()
    {
        var request = new SetGeoreferenceRequest();
        Assert.True(request.IsClear);
        Assert.Empty(request.Validate());
        Assert.Null(request.ToGeoreference());
    }

    [Fact]
    public void CompleteBodyValidatesAndMaterializes()
    {
        var request = Complete();
        Assert.Empty(request.Validate());
        var georeference = request.ToGeoreference();
        Assert.NotNull(georeference);
        Assert.Equal(49.1, georeference!.AnchorLatitude);
        Assert.Equal(8.44, georeference.AnchorLongitude);
    }

    [Fact]
    public void PartialBodyIsRejected()
    {
        var request = new SetGeoreferenceRequest { AnchorLatitude = 49.1, AnchorLongitude = 8.44 };
        Assert.Contains(request.Validate(), error => error.Contains("all six", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(91, 8, 0, 1)]
    [InlineData(-91, 8, 0, 1)]
    [InlineData(49, 181, 0, 1)]
    [InlineData(49, -181, 0, 1)]
    [InlineData(49, 8, 361, 1)]
    [InlineData(49, 8, -361, 1)]
    [InlineData(49, 8, 0, 0)]
    [InlineData(49, 8, 0, -1)]
    [InlineData(49, 8, 0, 10_001)]
    public void OutOfRangeValuesAreRejected(
        double anchorLatitude,
        double anchorLongitude,
        double rotationDegrees,
        double metersPerUnit)
    {
        var request = Complete(anchorLatitude, anchorLongitude, rotationDegrees, metersPerUnit);
        Assert.NotEmpty(request.Validate());
    }

    [Fact]
    public void NonFiniteAnchorCoordinatesAreRejected()
    {
        var request = new SetGeoreferenceRequest
        {
            AnchorLatitude = 49.1,
            AnchorLongitude = 8.44,
            AnchorX = double.NaN,
            AnchorY = 0,
            RotationDegrees = 0,
            MetersPerUnit = 1,
        };
        Assert.NotEmpty(request.Validate());
    }
}
