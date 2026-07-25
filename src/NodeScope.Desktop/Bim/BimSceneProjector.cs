using System.Numerics;

namespace NodeScope.Desktop.Bim;

/// <summary>A screen-space triangle used by the CPU renderer and headless visual tests.</summary>
internal readonly record struct ProjectedBimTriangle(
    Vector2 A,
    Vector2 B,
    Vector2 C,
    float Depth,
    Vector4 Color);

/// <summary>
/// Pure projection path for the same parsed scene and camera as the GL renderer.
/// Keeping this deterministic makes geometry orientation, transforms, and camera
/// regressions testable on CI machines without a graphics context.
/// </summary>
internal static class BimSceneProjector
{
    private static readonly Vector3 Light = Vector3.Normalize(new Vector3(-0.35f, -0.45f, 0.82f));

    public static List<ProjectedBimTriangle> Project(
        BimScene scene,
        BimCamera camera,
        int width,
        int height,
        int maximumTriangles = int.MaxValue) =>
        Project(
            scene,
            camera,
            width,
            height,
            BimRenderOptions.Empty,
            maximumTriangles);

    public static List<ProjectedBimTriangle> Project(
        BimScene scene,
        BimCamera camera,
        int width,
        int height,
        BimRenderOptions options,
        int maximumTriangles = int.MaxValue)
    {
        ArgumentNullException.ThrowIfNull(scene);
        ArgumentNullException.ThrowIfNull(camera);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(width);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(height);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(maximumTriangles);

        var snapshot = camera.Snapshot((double)width / height);
        var viewProjection = snapshot.View * snapshot.Projection;
        var geometries = scene.Geometries.Concat(BimDeviceMeshes.Build(scene, options));
        var declaredTriangles = CountVisibleTriangles(geometries, options);
        var sampleStride = Math.Max(
            1L,
            (long)Math.Ceiling((double)declaredTriangles / maximumTriangles));
        var capacity = (int)Math.Min(declaredTriangles, maximumTriangles);
        var result = new List<ProjectedBimTriangle>(capacity);
        long triangleOrdinal = 0;
        foreach (var geometry in geometries)
        {
            foreach (var instance in geometry.Instances)
            {
                if (!options.IsVisible(instance))
                {
                    continue;
                }

                for (var vertex = 0; vertex < geometry.VertexCount; vertex += 3)
                {
                    if (triangleOrdinal++ % sampleStride != 0
                        || result.Count >= maximumTriangles)
                    {
                        continue;
                    }

                    var a = ReadPosition(geometry.Vertices, vertex);
                    var b = ReadPosition(geometry.Vertices, vertex + 1);
                    var c = ReadPosition(geometry.Vertices, vertex + 2);
                    a = Vector3.Transform(a, instance.Transform);
                    b = Vector3.Transform(b, instance.Transform);
                    c = Vector3.Transform(c, instance.Transform);

                    var polygon = ClipSection(a, b, c, options.Section);
                    if (polygon.Count < 3)
                    {
                        continue;
                    }

                    var normal = Vector3.Cross(b - a, c - a);
                    normal = normal.LengthSquared() > float.Epsilon
                        ? Vector3.Normalize(normal)
                        : Vector3.UnitZ;
                    var diffuse = MathF.Max(MathF.Abs(Vector3.Dot(normal, Light)), 0f);
                    var intensity = 0.34f + (0.66f * diffuse);
                    var baseColor = options.Color(instance);
                    var color = new Vector4(
                        Math.Clamp(baseColor.X * intensity, 0f, 1f),
                        Math.Clamp(baseColor.Y * intensity, 0f, 1f),
                        Math.Clamp(baseColor.Z * intensity, 0f, 1f),
                        baseColor.W);
                    for (var index = 1; index < polygon.Count - 1; index++)
                    {
                        if (result.Count >= maximumTriangles)
                        {
                            break;
                        }

                        AddProjectedTriangle(
                            result,
                            polygon[0],
                            polygon[index],
                            polygon[index + 1],
                            viewProjection,
                            width,
                            height,
                            color);
                    }
                }
            }
        }

        // Painter order is sufficient for the deterministic thumbnail. The GL
        // path uses a real depth buffer and a separate transparent pass.
        result.Sort(static (left, right) => right.Depth.CompareTo(left.Depth));
        return result;
    }

    private static void AddProjectedTriangle(
        List<ProjectedBimTriangle> result,
        Vector3 a,
        Vector3 b,
        Vector3 c,
        Matrix4x4 viewProjection,
        int width,
        int height,
        Vector4 color)
    {
        var clipA = Vector4.Transform(new Vector4(a, 1f), viewProjection);
        var clipB = Vector4.Transform(new Vector4(b, 1f), viewProjection);
        var clipC = Vector4.Transform(new Vector4(c, 1f), viewProjection);
        if (clipA.W <= 0 || clipB.W <= 0 || clipC.W <= 0)
        {
            return;
        }

        var ndcA = clipA / clipA.W;
        var ndcB = clipB / clipB.W;
        var ndcC = clipC / clipC.W;
        if (OutsideSameClipPlane(ndcA, ndcB, ndcC))
        {
            return;
        }

        result.Add(new ProjectedBimTriangle(
            ToScreen(ndcA, width, height),
            ToScreen(ndcB, width, height),
            ToScreen(ndcC, width, height),
            (ndcA.Z + ndcB.Z + ndcC.Z) / 3f,
            color));
    }

    private static List<Vector3> ClipSection(
        Vector3 a,
        Vector3 b,
        Vector3 c,
        BimSectionPlane section)
    {
        if (!section.Enabled)
        {
            return [a, b, c];
        }

        ReadOnlySpan<Vector3> input = [a, b, c];
        var result = new List<Vector3>(4);
        var previous = input[^1];
        var previousDistance = section.SignedDistance(previous);
        var previousInside = previousDistance <= 0f;
        foreach (var current in input)
        {
            var currentDistance = section.SignedDistance(current);
            var currentInside = currentDistance <= 0f;
            if (currentInside != previousInside)
            {
                var amount = previousDistance / (previousDistance - currentDistance);
                result.Add(Vector3.Lerp(previous, current, amount));
            }

            if (currentInside)
            {
                result.Add(current);
            }

            previous = current;
            previousDistance = currentDistance;
            previousInside = currentInside;
        }

        return result;
    }

    private static long CountVisibleTriangles(
        IEnumerable<BimGeometry> geometries,
        BimRenderOptions options)
    {
        long result = 0;
        foreach (var geometry in geometries)
        {
            var triangles = geometry.VertexCount / 3L;
            var instances = geometry.Instances.LongCount(options.IsVisible);
            if (instances != 0 && triangles > (long.MaxValue - result) / instances)
            {
                return long.MaxValue;
            }

            result += triangles * instances;
        }

        return result;
    }

    private static Vector3 ReadPosition(float[] values, int vertex)
    {
        var offset = vertex * BimGeometry.FloatsPerVertex;
        return new Vector3(values[offset], values[offset + 1], values[offset + 2]);
    }

    private static bool OutsideSameClipPlane(Vector4 a, Vector4 b, Vector4 c) =>
        (a.X < -1 && b.X < -1 && c.X < -1)
        || (a.X > 1 && b.X > 1 && c.X > 1)
        || (a.Y < -1 && b.Y < -1 && c.Y < -1)
        || (a.Y > 1 && b.Y > 1 && c.Y > 1)
        || (a.Z < -1 && b.Z < -1 && c.Z < -1)
        || (a.Z > 1 && b.Z > 1 && c.Z > 1);

    private static Vector2 ToScreen(Vector4 ndc, int width, int height) => new(
        (ndc.X + 1f) * 0.5f * width,
        (1f - ndc.Y) * 0.5f * height);
}
