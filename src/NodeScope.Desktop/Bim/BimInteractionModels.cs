using System.Numerics;

namespace NodeScope.Desktop.Bim;

internal enum BimSectionAxis
{
    X,
    Y,
    Z,
}

internal readonly record struct BimSectionPlane(
    bool Enabled,
    BimSectionAxis Axis,
    float Constant)
{
    public float SignedDistance(Vector3 point) => Axis switch
    {
        BimSectionAxis.X => point.X - Constant,
        BimSectionAxis.Y => point.Y - Constant,
        _ => point.Z - Constant,
    };

    public Vector4 Equation => Axis switch
    {
        BimSectionAxis.X => new Vector4(1f, 0f, 0f, -Constant),
        BimSectionAxis.Y => new Vector4(0f, 1f, 0f, -Constant),
        _ => new Vector4(0f, 0f, 1f, -Constant),
    };
}

internal sealed record BimDeviceVisual(
    string Id,
    string Name,
    string Category,
    Vector3 Position,
    string Status,
    int? Floor,
    string? FloorLabel);

/// <summary>
/// Immutable interaction snapshot consumed by both renderers and the picker.
/// Replacing one snapshot makes a complete state change atomic for a frame.
/// </summary>
internal sealed record BimRenderOptions(
    IReadOnlySet<int> HiddenProductLabels,
    int? IsolatedProductLabel,
    int? SelectedProductLabel,
    string? SelectedDeviceId,
    BimSectionPlane Section,
    IReadOnlyList<BimDeviceVisual> Devices)
{
    private static readonly Vector4 SelectionColor = new(0.12f, 0.72f, 1f, 1f);

    public static BimRenderOptions Empty { get; } = new(
        new HashSet<int>(),
        null,
        null,
        null,
        new BimSectionPlane(false, BimSectionAxis.Z, 0f),
        []);

    public bool IsVisible(BimInstance instance)
    {
        if (instance.DeviceId is not null)
        {
            return true;
        }

        return instance.IsVisible
            && !HiddenProductLabels.Contains(instance.ProductLabel)
            && (IsolatedProductLabel is null
                || IsolatedProductLabel == instance.ProductLabel);
    }

    public Vector4 Color(BimInstance instance) =>
        ((instance.DeviceId is not null
            && string.Equals(instance.DeviceId, SelectedDeviceId, StringComparison.Ordinal))
        || (instance.DeviceId is null
            && instance.ProductLabel == SelectedProductLabel))
                ? SelectionColor
                : instance.Color;
}

internal readonly record struct BimRay(Vector3 Origin, Vector3 Direction);

internal enum BimPickKind
{
    Product,
    Device,
}

internal sealed record BimPickResult(
    BimPickKind Kind,
    Vector3 Point,
    Vector3 Normal,
    float Distance,
    int? ProductLabel = null,
    string? DeviceId = null);

internal delegate void BimPickedEventHandler(object? sender, BimPickResult? result);
