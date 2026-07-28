namespace NodeScope.Modules.Inventory.Domain;

/// <summary>
/// The affine bridge between a building model's local frame and geographic space: the model
/// point (<see cref="AnchorX"/>, <see cref="AnchorY"/>) sits at (<see cref="AnchorLatitude"/>,
/// <see cref="AnchorLongitude"/>), <see cref="RotationDegrees"/> is the clockwise angle from
/// the model's +Y axis to true north (IFC TrueNorth (x, y) = atan2(x, y)), and
/// <see cref="MetersPerUnit"/> converts model units to metres.
/// </summary>
public sealed record ModelGeoreference(
    double AnchorLatitude,
    double AnchorLongitude,
    double AnchorX,
    double AnchorY,
    double RotationDegrees,
    double MetersPerUnit)
{
    // WGS84 ellipsoid; local tangent radii keep building-scale offsets centimetre-accurate.
    private const double SemiMajorAxis = 6_378_137.0;

    private const double Flattening = 1.0 / 298.257_223_563;

    private const double EccentricitySquared = Flattening * (2.0 - Flattening);

    /// <summary>Projects a model-frame point onto WGS84 latitude/longitude.</summary>
    public (double Latitude, double Longitude) Project(double x, double y)
    {
        var eastUnits = x - AnchorX;
        var northUnits = y - AnchorY;
        var rotation = double.DegreesToRadians(RotationDegrees);

        // True north in the model plane is (sin θ, cos θ); east is 90° clockwise from it.
        var northMeters = ((eastUnits * Math.Sin(rotation)) + (northUnits * Math.Cos(rotation))) * MetersPerUnit;
        var eastMeters = ((eastUnits * Math.Cos(rotation)) - (northUnits * Math.Sin(rotation))) * MetersPerUnit;

        var anchorRadians = double.DegreesToRadians(AnchorLatitude);
        var sinLatSquared = Math.Sin(anchorRadians) * Math.Sin(anchorRadians);
        var meridianRadius = SemiMajorAxis * (1.0 - EccentricitySquared)
            / Math.Pow(1.0 - (EccentricitySquared * sinLatSquared), 1.5);
        var primeVerticalRadius = SemiMajorAxis / Math.Sqrt(1.0 - (EccentricitySquared * sinLatSquared));

        var latitude = AnchorLatitude + double.RadiansToDegrees(northMeters / meridianRadius);
        var longitude = AnchorLongitude
            + double.RadiansToDegrees(eastMeters / (primeVerticalRadius * Math.Cos(anchorRadians)));

        latitude = Math.Clamp(latitude, -90.0, 90.0);
        if (longitude is < -180.0 or > 180.0)
        {
            longitude = ((longitude + 540.0) % 360.0) - 180.0;
        }

        return (latitude, longitude);
    }
}
