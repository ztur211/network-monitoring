using System.Numerics;

namespace NodeScope.Desktop.Bim;

/// <summary>
/// Small procedural equipment models. They use the IFC model's one-metre scale
/// so a rack remains human-sized whether the source coordinates are metres or
/// millimetres.
/// </summary>
internal static class BimDeviceMeshes
{
    private static readonly float[] UnitBox = BuildUnitBox();
    private static readonly float[] UnitCylinder = BuildUnitCylinder(16);
    private static readonly BimBounds UnitBounds =
        new(new Vector3(-0.5f, -0.5f, 0f), new Vector3(0.5f, 0.5f, 1f));

    public static IReadOnlyList<BimGeometry> Build(
        BimScene scene,
        BimRenderOptions options)
    {
        var result = new List<BimGeometry>(options.Devices.Count);
        var index = 0;
        foreach (var device in options.Devices)
        {
            var (shape, size) = Shape(device.Category);
            var scale = scene.Meter * size;
            var transform =
                Matrix4x4.CreateScale(scale)
                * Matrix4x4.CreateTranslation(device.Position);
            var color = StatusColor(device.Status);
            result.Add(new BimGeometry(
                shape == DeviceShape.Dome ? UnitCylinder : UnitBox,
                shape == DeviceShape.Dome ? UnitCylinder.Length / 18 : 12,
                UnitBounds,
                [
                    new BimInstance(
                        int.MinValue + index,
                        short.MinValue,
                        int.MinValue + index,
                        transform,
                        color,
                        device.Id),
                ]));
            index++;
        }

        return result;
    }

    public static BimBounds Bounds(BimScene scene, BimDeviceVisual device)
    {
        var (_, size) = Shape(device.Category);
        var half = scene.Meter * size * new Vector3(0.5f, 0.5f, 0f);
        var height = scene.Meter * size.Z;
        return new BimBounds(
            device.Position - half,
            device.Position + new Vector3(half.X, half.Y, height));
    }

    private static (DeviceShape Shape, Vector3 Size) Shape(string category) =>
        category switch
        {
            "SWITCH" or "ROUTER" or "FIREWALL" or "DSLAM" or "RAD" =>
                (DeviceShape.Box, new Vector3(1.6f, 1f, 0.4f)),
            "SERVER_RACK" or "PATCH_PANEL" or "UPS" =>
                (DeviceShape.Box, new Vector3(0.8f, 0.8f, 2f)),
            "ACCESS_POINT" or "WIFI_EXTENDER" or "WIRELESS_BRIDGE" =>
                (DeviceShape.Dome, new Vector3(0.7f, 0.7f, 0.35f)),
            "PHONE" or "TABLET" or "PRINTER" or "COMPUTER" =>
                (DeviceShape.Box, new Vector3(0.5f, 0.32f, 0.08f)),
            "ONT" or "MODEM" or "FIBER_MEDIA_CONVERTER" or "IOT_DEVICE" =>
                (DeviceShape.Box, new Vector3(0.6f, 0.5f, 0.3f)),
            _ => (DeviceShape.Box, new Vector3(0.6f)),
        };

    private static Vector4 StatusColor(string status) => status switch
    {
        "UP" => new Vector4(0.21f, 0.77f, 0.42f, 1f),
        "DOWN" => new Vector4(0.9f, 0.28f, 0.3f, 1f),
        "WARNING" => new Vector4(0.96f, 0.65f, 0.14f, 1f),
        _ => new Vector4(0.54f, 0.56f, 0.6f, 1f),
    };

    private static float[] BuildUnitBox()
    {
        var vertices = new List<float>(36 * BimGeometry.FloatsPerVertex);
        AddFace(vertices, new Vector3(-0.5f, -0.5f, 0f), new Vector3(0.5f, -0.5f, 0f),
            new Vector3(0.5f, 0.5f, 0f), new Vector3(-0.5f, 0.5f, 0f), -Vector3.UnitZ);
        AddFace(vertices, new Vector3(-0.5f, 0.5f, 1f), new Vector3(0.5f, 0.5f, 1f),
            new Vector3(0.5f, -0.5f, 1f), new Vector3(-0.5f, -0.5f, 1f), Vector3.UnitZ);
        AddFace(vertices, new Vector3(-0.5f, -0.5f, 0f), new Vector3(-0.5f, -0.5f, 1f),
            new Vector3(0.5f, -0.5f, 1f), new Vector3(0.5f, -0.5f, 0f), -Vector3.UnitY);
        AddFace(vertices, new Vector3(0.5f, 0.5f, 0f), new Vector3(0.5f, 0.5f, 1f),
            new Vector3(-0.5f, 0.5f, 1f), new Vector3(-0.5f, 0.5f, 0f), Vector3.UnitY);
        AddFace(vertices, new Vector3(-0.5f, 0.5f, 0f), new Vector3(-0.5f, 0.5f, 1f),
            new Vector3(-0.5f, -0.5f, 1f), new Vector3(-0.5f, -0.5f, 0f), -Vector3.UnitX);
        AddFace(vertices, new Vector3(0.5f, -0.5f, 0f), new Vector3(0.5f, -0.5f, 1f),
            new Vector3(0.5f, 0.5f, 1f), new Vector3(0.5f, 0.5f, 0f), Vector3.UnitX);
        return [.. vertices];
    }

    private static float[] BuildUnitCylinder(int segments)
    {
        var vertices = new List<float>(segments * 12 * BimGeometry.FloatsPerVertex);
        for (var segment = 0; segment < segments; segment++)
        {
            var angleA = MathF.Tau * segment / segments;
            var angleB = MathF.Tau * (segment + 1) / segments;
            var a = new Vector3(MathF.Cos(angleA) * 0.5f, MathF.Sin(angleA) * 0.5f, 0f);
            var b = new Vector3(MathF.Cos(angleB) * 0.5f, MathF.Sin(angleB) * 0.5f, 0f);
            var topA = a + Vector3.UnitZ;
            var topB = b + Vector3.UnitZ;
            var normalA = Vector3.Normalize(new Vector3(a.X, a.Y, 0f));
            var normalB = Vector3.Normalize(new Vector3(b.X, b.Y, 0f));
            AddTriangle(vertices, a, topA, topB, normalA, normalA, normalB);
            AddTriangle(vertices, a, topB, b, normalA, normalB, normalB);
            AddTriangle(vertices, Vector3.UnitZ, topB, topA, Vector3.UnitZ, Vector3.UnitZ, Vector3.UnitZ);
            AddTriangle(vertices, Vector3.Zero, a, b, -Vector3.UnitZ, -Vector3.UnitZ, -Vector3.UnitZ);
        }

        return [.. vertices];
    }

    private static void AddFace(
        List<float> values,
        Vector3 a,
        Vector3 b,
        Vector3 c,
        Vector3 d,
        Vector3 normal)
    {
        AddTriangle(values, a, b, c, normal, normal, normal);
        AddTriangle(values, a, c, d, normal, normal, normal);
    }

    private static void AddTriangle(
        List<float> values,
        Vector3 a,
        Vector3 b,
        Vector3 c,
        Vector3 normalA,
        Vector3 normalB,
        Vector3 normalC)
    {
        AddVertex(values, a, normalA);
        AddVertex(values, b, normalB);
        AddVertex(values, c, normalC);
    }

    private static void AddVertex(List<float> values, Vector3 position, Vector3 normal)
    {
        values.Add(position.X);
        values.Add(position.Y);
        values.Add(position.Z);
        values.Add(normal.X);
        values.Add(normal.Y);
        values.Add(normal.Z);
    }

    private enum DeviceShape
    {
        Box,
        Dome,
    }
}
