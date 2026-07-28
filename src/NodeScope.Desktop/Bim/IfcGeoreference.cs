using System.Numerics;
using Xbim.Common;
using Xbim.Ifc4.Interfaces;

namespace NodeScope.Desktop.Bim;

/// <summary>
/// A model-frame to WGS84 bridge extracted from the IFC at import time, in the appliance's
/// georeference shape: the scene point (<see cref="AnchorX"/>, <see cref="AnchorY"/>) sits at
/// (<see cref="AnchorLatitude"/>, <see cref="AnchorLongitude"/>), rotation is the clockwise
/// angle from scene +Y to true north, and <see cref="MetersPerUnit"/> converts scene units
/// to metres.
/// </summary>
internal sealed record BimGeoreference(
    double AnchorLatitude,
    double AnchorLongitude,
    double AnchorX,
    double AnchorY,
    double RotationDegrees,
    double MetersPerUnit);

/// <summary>
/// Reads the IFC's own georeferencing - IfcSite RefLatitude/RefLongitude, the site's world
/// placement, and the model context's TrueNorth - and restates it in the wexBIM scene frame
/// (world minus the header's WCS offset, in model units). Returns null when the file carries
/// no usable georeference; (0, 0) exactly is treated as the exporter default it almost
/// always is, not as a building in the Gulf of Guinea.
/// </summary>
internal static class IfcGeoreferenceExtractor
{
    public static BimGeoreference? Extract(IModel model, Vector3 sceneWorldOrigin)
    {
        ArgumentNullException.ThrowIfNull(model);
        var site = model.Instances
            .OfType<IIfcSite>()
            .FirstOrDefault(candidate => candidate.RefLatitude is not null && candidate.RefLongitude is not null);
        if (site is null)
        {
            return null;
        }

        var latitude = site.RefLatitude!.Value.AsDouble;
        var longitude = site.RefLongitude!.Value.AsDouble;
        if (!double.IsFinite(latitude) || !double.IsFinite(longitude)
            || latitude is < -90 or > 90 || longitude is < -180 or > 180
            || (latitude == 0 && longitude == 0))
        {
            return null;
        }

        var unitsPerMetre = model.ModelFactors?.OneMeter ?? 1.0;
        if (!double.IsFinite(unitsPerMetre) || unitsPerMetre <= 0)
        {
            return null;
        }

        var siteOrigin = WorldOrigin(site.ObjectPlacement);
        return new BimGeoreference(
            latitude,
            longitude,
            siteOrigin.X - sceneWorldOrigin.X,
            siteOrigin.Y - sceneWorldOrigin.Y,
            TrueNorthDegrees(model),
            1.0 / unitsPerMetre);
    }

    /// <summary>The clockwise angle from +Y to the model context's TrueNorth (0° when absent).</summary>
    private static double TrueNorthDegrees(IModel model)
    {
        var trueNorth = model.Instances
            .OfType<IIfcGeometricRepresentationContext>()
            .Where(context => context is not IIfcGeometricRepresentationSubContext)
            .Select(context => context.TrueNorth)
            .FirstOrDefault(direction => direction is not null);
        if (trueNorth is null)
        {
            return 0;
        }

        var x = trueNorth.X;
        var y = trueNorth.Y;
        return double.IsFinite(x) && double.IsFinite(y) && (x != 0 || y != 0)
            ? double.RadiansToDegrees(Math.Atan2(x, y))
            : 0;
    }

    /// <summary>
    /// The placement's origin in world coordinates: the local origin pushed up through every
    /// ancestor placement's full frame (a parent's rotation applies to child translations).
    /// </summary>
    private static (double X, double Y) WorldOrigin(IIfcObjectPlacement? placement)
    {
        var point = (X: 0.0, Y: 0.0, Z: 0.0);
        var depth = 0;
        while (placement is IIfcLocalPlacement local && depth++ < 64)
        {
            point = Apply(local.RelativePlacement, point);
            placement = local.PlacementRelTo;
        }

        return (point.X, point.Y);
    }

    private static (double X, double Y, double Z) Apply(
        IIfcAxis2Placement? placement,
        (double X, double Y, double Z) point)
    {
        switch (placement)
        {
            case IIfcAxis2Placement3D placement3d:
                {
                    var z = Normalize(Direction(placement3d.Axis, (0, 0, 1)));
                    var xHint = Direction(placement3d.RefDirection, (1, 0, 0));
                    var x = Normalize(Subtract(xHint, Scale(z, Dot(xHint, z))));
                    var y = Cross(z, x);
                    var location = Location(placement3d.Location);
                    return (
                        location.X + (point.X * x.X) + (point.Y * y.X) + (point.Z * z.X),
                        location.Y + (point.X * x.Y) + (point.Y * y.Y) + (point.Z * z.Y),
                        location.Z + (point.X * x.Z) + (point.Y * y.Z) + (point.Z * z.Z));
                }

            case IIfcAxis2Placement2D placement2d:
                {
                    var xHint = Direction2d(placement2d.RefDirection);
                    var x = Normalize((xHint.X, xHint.Y, 0));
                    var y = (X: -x.Y, Y: x.X);
                    var location = Location(placement2d.Location);
                    return (
                        location.X + (point.X * x.X) + (point.Y * y.X),
                        location.Y + (point.X * x.Y) + (point.Y * y.Y),
                        location.Z + point.Z);
                }

            default:
                return point;
        }
    }

    private static (double X, double Y, double Z) Direction(
        IIfcDirection? direction,
        (double X, double Y, double Z) fallback) =>
        direction is null ? fallback : (direction.X, direction.Y, double.IsNaN(direction.Z) ? 0 : direction.Z);

    private static (double X, double Y) Direction2d(IIfcDirection? direction) =>
        direction is null ? (1, 0) : (direction.X, direction.Y);

    private static (double X, double Y, double Z) Location(IIfcCartesianPoint? location) =>
        location is null
            ? (0, 0, 0)
            : (location.X, location.Y, double.IsNaN(location.Z) ? 0 : location.Z);

    private static (double X, double Y, double Z) Normalize((double X, double Y, double Z) vector)
    {
        var length = Math.Sqrt((vector.X * vector.X) + (vector.Y * vector.Y) + (vector.Z * vector.Z));
        return length < 1e-9 ? (0, 0, 1) : (vector.X / length, vector.Y / length, vector.Z / length);
    }

    private static (double X, double Y, double Z) Subtract(
        (double X, double Y, double Z) a,
        (double X, double Y, double Z) b) => (a.X - b.X, a.Y - b.Y, a.Z - b.Z);

    private static (double X, double Y, double Z) Scale((double X, double Y, double Z) vector, double factor) =>
        (vector.X * factor, vector.Y * factor, vector.Z * factor);

    private static double Dot((double X, double Y, double Z) a, (double X, double Y, double Z) b) =>
        (a.X * b.X) + (a.Y * b.Y) + (a.Z * b.Z);

    private static (double X, double Y, double Z) Cross(
        (double X, double Y, double Z) a,
        (double X, double Y, double Z) b) =>
        ((a.Y * b.Z) - (a.Z * b.Y), (a.Z * b.X) - (a.X * b.Z), (a.X * b.Y) - (a.Y * b.X));
}
