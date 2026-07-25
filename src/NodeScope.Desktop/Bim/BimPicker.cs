using System.Numerics;

namespace NodeScope.Desktop.Bim;

/// <summary>
/// Model-space picking index. A median-split BVH rejects almost all instances,
/// then Moller-Trumbore tests return an exact surface point and normal.
/// </summary>
internal sealed class BimPicker
{
    private const int LeafSize = 8;
    private const float Epsilon = 0.00001f;

    private readonly BimScene _scene;
    private readonly PickEntry[] _entries;
    private readonly BvhNode? _root;

    public BimPicker(BimScene scene)
    {
        ArgumentNullException.ThrowIfNull(scene);
        _scene = scene;
        _entries =
        [
            .. scene.Geometries.SelectMany(geometry =>
                geometry.Instances.Select(instance => new PickEntry(
                    geometry,
                    instance,
                    geometry.Bounds.Transform(instance.Transform)))),
        ];
        _root = _entries.Length == 0 ? null : Build(0, _entries.Length);
    }

    public BimPickResult? Pick(
        BimRay ray,
        BimRenderOptions options,
        bool includeDevices = true)
    {
        ArgumentNullException.ThrowIfNull(options);
        var direction = ray.Direction.LengthSquared() > float.Epsilon
            ? Vector3.Normalize(ray.Direction)
            : Vector3.UnitZ;
        ray = ray with { Direction = direction };

        BimPickResult? closest = includeDevices
            ? PickDevices(ray, options)
            : null;
        var closestDistance = closest?.Distance ?? float.PositiveInfinity;
        if (_root is null)
        {
            return closest;
        }

        var stack = new Stack<BvhNode>();
        stack.Push(_root);
        while (stack.Count > 0)
        {
            var node = stack.Pop();
            if (!IntersectBounds(ray, node.Bounds, out var nodeDistance, out _)
                || nodeDistance > closestDistance)
            {
                continue;
            }

            if (node.Left is not null)
            {
                stack.Push(node.Left);
                stack.Push(node.Right!);
                continue;
            }

            for (var index = node.Start; index < node.Start + node.Count; index++)
            {
                var entry = _entries[index];
                if (!options.IsVisible(entry.Instance)
                    || !IntersectBounds(ray, entry.Bounds, out var boundsDistance, out _)
                    || boundsDistance > closestDistance)
                {
                    continue;
                }

                var hit = IntersectGeometry(ray, entry, options.Section, closestDistance);
                if (hit is null)
                {
                    continue;
                }

                closest = hit;
                closestDistance = hit.Distance;
            }
        }

        return closest;
    }

    private BimPickResult? PickDevices(BimRay ray, BimRenderOptions options)
    {
        BimPickResult? closest = null;
        var closestDistance = float.PositiveInfinity;
        foreach (var device in options.Devices)
        {
            var bounds = BimDeviceMeshes.Bounds(_scene, device);
            if (!IntersectBounds(ray, bounds, out var distance, out var normal)
                || distance >= closestDistance)
            {
                continue;
            }

            var point = ray.Origin + (ray.Direction * distance);
            if (options.Section.Enabled && options.Section.SignedDistance(point) > Epsilon)
            {
                continue;
            }

            closestDistance = distance;
            closest = new BimPickResult(
                BimPickKind.Device,
                point,
                normal,
                distance,
                DeviceId: device.Id);
        }

        return closest;
    }

    private static BimPickResult? IntersectGeometry(
        BimRay ray,
        PickEntry entry,
        BimSectionPlane section,
        float maximumDistance)
    {
        BimPickResult? closest = null;
        var closestDistance = maximumDistance;
        var vertices = entry.Geometry.Vertices;
        for (var vertex = 0; vertex < entry.Geometry.VertexCount; vertex += 3)
        {
            var a = Vector3.Transform(ReadPosition(vertices, vertex), entry.Instance.Transform);
            var b = Vector3.Transform(ReadPosition(vertices, vertex + 1), entry.Instance.Transform);
            var c = Vector3.Transform(ReadPosition(vertices, vertex + 2), entry.Instance.Transform);
            if (!IntersectTriangle(ray, a, b, c, out var distance)
                || distance >= closestDistance)
            {
                continue;
            }

            var point = ray.Origin + (ray.Direction * distance);
            if (section.Enabled && section.SignedDistance(point) > Epsilon)
            {
                continue;
            }

            var normal = Vector3.Cross(b - a, c - a);
            if (normal.LengthSquared() <= float.Epsilon)
            {
                continue;
            }

            normal = Vector3.Normalize(normal);
            if (Vector3.Dot(normal, ray.Direction) > 0)
            {
                normal = -normal;
            }

            closestDistance = distance;
            closest = new BimPickResult(
                BimPickKind.Product,
                point,
                normal,
                distance,
                ProductLabel: entry.Instance.ProductLabel);
        }

        return closest;
    }

    private static bool IntersectTriangle(
        BimRay ray,
        Vector3 a,
        Vector3 b,
        Vector3 c,
        out float distance)
    {
        var edge1 = b - a;
        var edge2 = c - a;
        var p = Vector3.Cross(ray.Direction, edge2);
        var determinant = Vector3.Dot(edge1, p);
        if (MathF.Abs(determinant) < Epsilon)
        {
            distance = 0;
            return false;
        }

        var inverse = 1f / determinant;
        var t = ray.Origin - a;
        var u = Vector3.Dot(t, p) * inverse;
        if (u is < 0f or > 1f)
        {
            distance = 0;
            return false;
        }

        var q = Vector3.Cross(t, edge1);
        var v = Vector3.Dot(ray.Direction, q) * inverse;
        if (v < 0f || u + v > 1f)
        {
            distance = 0;
            return false;
        }

        distance = Vector3.Dot(edge2, q) * inverse;
        return distance > Epsilon;
    }

    private BvhNode Build(int start, int count)
    {
        var bounds = BimBounds.Empty;
        var centroidBounds = BimBounds.Empty;
        for (var index = start; index < start + count; index++)
        {
            bounds = bounds.Include(_entries[index].Bounds);
            centroidBounds = centroidBounds.Include(_entries[index].Bounds.Center);
        }

        if (count <= LeafSize)
        {
            return new BvhNode(bounds, start, count, null, null);
        }

        var size = centroidBounds.Size;
        var axis = size.X >= size.Y && size.X >= size.Z
            ? 0
            : size.Y >= size.Z
                ? 1
                : 2;
        Array.Sort(
            _entries,
            start,
            count,
            Comparer<PickEntry>.Create((left, right) =>
                Coordinate(left.Bounds.Center, axis).CompareTo(
                    Coordinate(right.Bounds.Center, axis))));
        var leftCount = count / 2;
        return new BvhNode(
            bounds,
            start,
            count,
            Build(start, leftCount),
            Build(start + leftCount, count - leftCount));
    }

    private static bool IntersectBounds(
        BimRay ray,
        BimBounds bounds,
        out float distance,
        out Vector3 normal)
    {
        var near = 0f;
        var far = float.PositiveInfinity;
        normal = Vector3.Zero;
        for (var axis = 0; axis < 3; axis++)
        {
            var origin = Coordinate(ray.Origin, axis);
            var direction = Coordinate(ray.Direction, axis);
            var minimum = Coordinate(bounds.Min, axis);
            var maximum = Coordinate(bounds.Max, axis);
            if (MathF.Abs(direction) < Epsilon)
            {
                if (origin < minimum || origin > maximum)
                {
                    distance = 0;
                    return false;
                }

                continue;
            }

            var inverse = 1f / direction;
            var first = (minimum - origin) * inverse;
            var second = (maximum - origin) * inverse;
            var firstNormal = AxisNormal(axis, -MathF.Sign(direction));
            if (first > second)
            {
                (first, second) = (second, first);
            }

            if (first > near)
            {
                near = first;
                normal = firstNormal;
            }

            far = MathF.Min(far, second);
            if (far < near)
            {
                distance = 0;
                return false;
            }
        }

        distance = near;
        return far >= 0;
    }

    private static Vector3 AxisNormal(int axis, float sign) => axis switch
    {
        0 => new Vector3(sign, 0f, 0f),
        1 => new Vector3(0f, sign, 0f),
        _ => new Vector3(0f, 0f, sign),
    };

    private static float Coordinate(Vector3 value, int axis) => axis switch
    {
        0 => value.X,
        1 => value.Y,
        _ => value.Z,
    };

    private static Vector3 ReadPosition(float[] values, int vertex)
    {
        var offset = vertex * BimGeometry.FloatsPerVertex;
        return new Vector3(values[offset], values[offset + 1], values[offset + 2]);
    }

    private sealed record PickEntry(
        BimGeometry Geometry,
        BimInstance Instance,
        BimBounds Bounds);

    private sealed record BvhNode(
        BimBounds Bounds,
        int Start,
        int Count,
        BvhNode? Left,
        BvhNode? Right);
}
