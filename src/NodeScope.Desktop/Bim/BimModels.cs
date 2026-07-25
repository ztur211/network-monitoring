using System.Numerics;

namespace NodeScope.Desktop.Bim;

/// <summary>An axis-aligned model-space box used to fit and pan the viewer camera.</summary>
internal readonly record struct BimBounds(Vector3 Min, Vector3 Max)
{
    public static BimBounds Empty { get; } = new(
        new Vector3(float.PositiveInfinity),
        new Vector3(float.NegativeInfinity));

    public bool IsEmpty =>
        !float.IsFinite(Min.X)
        || !float.IsFinite(Min.Y)
        || !float.IsFinite(Min.Z)
        || !float.IsFinite(Max.X)
        || !float.IsFinite(Max.Y)
        || !float.IsFinite(Max.Z)
        || Min.X > Max.X
        || Min.Y > Max.Y
        || Min.Z > Max.Z;

    public Vector3 Center => IsEmpty ? Vector3.Zero : (Min + Max) * 0.5f;

    public Vector3 Size => IsEmpty ? Vector3.Zero : Max - Min;

    public float Radius => MathF.Max(Size.Length() * 0.5f, 0.001f);

    public BimBounds Include(Vector3 point) => IsFinite(point)
        ? IsEmpty
            ? new BimBounds(point, point)
            : new BimBounds(Vector3.Min(Min, point), Vector3.Max(Max, point))
        : this;

    public BimBounds Include(BimBounds other) =>
        other.IsEmpty ? this : Include(other.Min).Include(other.Max);

    /// <summary>
    /// Transforms all eight corners. Transforming only min/max is incorrect under
    /// rotation and is a common cause of models being clipped by a fitted camera.
    /// </summary>
    public BimBounds Transform(Matrix4x4 transform)
    {
        if (IsEmpty)
        {
            return this;
        }

        var result = Empty;
        for (var x = 0; x < 2; x++)
        {
            for (var y = 0; y < 2; y++)
            {
                for (var z = 0; z < 2; z++)
                {
                    result = result.Include(Vector3.Transform(
                        new Vector3(
                            x == 0 ? Min.X : Max.X,
                            y == 0 ? Min.Y : Max.Y,
                            z == 0 ? Min.Z : Max.Z),
                        transform));
                }
            }
        }

        return result;
    }

    private static bool IsFinite(Vector3 value) =>
        float.IsFinite(value.X) && float.IsFinite(value.Y) && float.IsFinite(value.Z);
}

/// <summary>
/// A wexBIM product enriched, when available, by the upload-time IFC element
/// index. Geometry remains usable when an older version has no enrichment.
/// </summary>
internal sealed record BimProduct(
    int Label,
    short Type,
    BimBounds Bounds,
    string? GlobalId = null,
    string? TypeName = null,
    string? Name = null);

/// <summary>
/// One placement of a shared geometry. Repetitions remain instances instead of
/// duplicating triangle data in memory and on the GPU.
/// </summary>
internal sealed record BimInstance(
    int ProductLabel,
    short ProductType,
    int InstanceLabel,
    Matrix4x4 Transform,
    Vector4 Color,
    string? DeviceId = null)
{
    private const short IfcOpeningElement = 498;
    private const short IfcOpeningStandardCase = 1217;
    private const short IfcSpace = 454;

    public bool IsTransparent => Color.W < 0.996f;

    public bool IsVisible =>
        ProductType is not IfcSpace and not IfcOpeningElement and not IfcOpeningStandardCase;
}

/// <summary>
/// A shared triangle list. Vertices are interleaved position xyz + normal xyz;
/// one draw call renders every placement through hardware instancing.
/// </summary>
internal sealed record BimGeometry(
    float[] Vertices,
    int TriangleCount,
    BimBounds Bounds,
    IReadOnlyList<BimInstance> Instances)
{
    public const int FloatsPerVertex = 6;

    public int VertexCount => Vertices.Length / FloatsPerVertex;
}

/// <summary>The fully decoded, renderer-independent form of one wexBIM model.</summary>
internal sealed record BimScene(
    byte FormatVersion,
    float Meter,
    Vector3 WorldCoordinateSystem,
    BimBounds Bounds,
    IReadOnlyList<BimGeometry> Geometries,
    IReadOnlyDictionary<int, BimProduct> Products,
    int ShapeCount,
    int TriangleCount,
    int SourceSizeBytes)
{
    public int VisibleProductCount =>
        Geometries
            .SelectMany(static geometry => geometry.Instances)
            .Where(static instance => instance.IsVisible)
            .Select(static instance => instance.ProductLabel)
            .Distinct()
            .Count();
}
