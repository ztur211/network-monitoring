using System.Numerics;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media;

namespace NodeScope.Desktop.Bim;

/// <summary>
/// CPU fallback for platforms where Avalonia cannot share an OpenGL context
/// with its compositor. It remains behind the GL surface and also owns camera
/// input so orbit, pan, and zoom behave identically in either rendering mode.
/// </summary>
internal sealed class SoftwareBimViewport : Control
{
    private const int MaximumRenderedTriangles = 30_000;

    private static readonly SolidColorBrush BackgroundBrush =
        new(Color.FromRgb(9, 16, 29));

    private readonly BimCamera _fallbackCamera = new();
    private BimScene? _scene;
    private BimCamera? _camera;
    private BimRenderOptions _options = BimRenderOptions.Empty;
    private BimPicker? _picker;
    private bool _renderModel = true;
    private Point _lastPointer;
    private Point _pressPointer;
    private DragMode _dragMode;
    private bool _pressedWithLeftButton;

    internal event BimPickedEventHandler? Picked;

    public bool RenderModel
    {
        get => _renderModel;
        set
        {
            if (_renderModel == value)
            {
                return;
            }

            _renderModel = value;
            InvalidateVisual();
        }
    }

    public bool PickProductsOnly { get; set; }

    public BimScene? Scene
    {
        get => _scene;
        set
        {
            if (ReferenceEquals(_scene, value))
            {
                return;
            }

            _scene = value;
            _picker = value is null ? null : new BimPicker(value);
            InvalidateVisual();
        }
    }

    public BimRenderOptions Options
    {
        get => _options;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            if (ReferenceEquals(_options, value))
            {
                return;
            }

            _options = value;
            InvalidateVisual();
        }
    }

    public BimCamera? Camera
    {
        get => _camera;
        set
        {
            if (ReferenceEquals(_camera, value))
            {
                return;
            }

            if (_camera is not null)
            {
                _camera.Changed -= OnCameraChanged;
            }

            _camera = value;
            if (_camera is not null)
            {
                _camera.Changed += OnCameraChanged;
            }

            InvalidateVisual();
        }
    }

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        context.DrawRectangle(BackgroundBrush, null, Bounds);

        if (!RenderModel || Scene is null || Bounds.Width < 1 || Bounds.Height < 1)
        {
            return;
        }

        var triangles = BimSceneProjector.Project(
            Scene,
            Camera ?? _fallbackCamera,
            Math.Max(1, (int)Math.Ceiling(Bounds.Width)),
            Math.Max(1, (int)Math.Ceiling(Bounds.Height)),
            Options,
            MaximumRenderedTriangles);
        var brushes = new Dictionary<uint, SolidColorBrush>();
        foreach (var triangle in triangles)
        {
            var geometry = new StreamGeometry();
            using (var path = geometry.Open())
            {
                path.BeginFigure(ToPoint(triangle.A), true);
                path.LineTo(ToPoint(triangle.B));
                path.LineTo(ToPoint(triangle.C));
                path.EndFigure(true);
            }

            var key = ToColorKey(triangle.Color);
            if (!brushes.TryGetValue(key, out var brush))
            {
                brush = new SolidColorBrush(Color.FromUInt32(key));
                brushes.Add(key, brush);
            }

            context.DrawGeometry(brush, null, geometry);
        }
    }

    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        base.OnPointerPressed(e);
        var point = e.GetCurrentPoint(this);
        _lastPointer = point.Position;
        _pressPointer = point.Position;
        _pressedWithLeftButton = point.Properties.IsLeftButtonPressed;
        _dragMode = point.Properties.IsMiddleButtonPressed
            || point.Properties.IsRightButtonPressed
            || (point.Properties.IsLeftButtonPressed && e.KeyModifiers.HasFlag(KeyModifiers.Shift))
                ? DragMode.Pan
                : point.Properties.IsLeftButtonPressed
                    ? DragMode.Orbit
                    : DragMode.None;
        if (_dragMode != DragMode.None)
        {
            e.Pointer.Capture(this);
            e.Handled = true;
        }
    }

    protected override void OnPointerMoved(PointerEventArgs e)
    {
        base.OnPointerMoved(e);
        if (_dragMode == DragMode.None)
        {
            return;
        }

        var position = e.GetPosition(this);
        var delta = position - _lastPointer;
        _lastPointer = position;
        if (_dragMode == DragMode.Pan)
        {
            (Camera ?? _fallbackCamera).Pan(delta.X, delta.Y, Bounds.Height);
        }
        else
        {
            (Camera ?? _fallbackCamera).Orbit(delta.X, delta.Y);
        }

        e.Handled = true;
    }

    protected override void OnPointerReleased(PointerReleasedEventArgs e)
    {
        base.OnPointerReleased(e);
        if (_dragMode == DragMode.None)
        {
            return;
        }

        var releasePosition = e.GetPosition(this);
        var wasClick = _pressedWithLeftButton
            && DistanceSquared(releasePosition, _pressPointer) <= 16d;
        e.Pointer.Capture(null);
        _dragMode = DragMode.None;
        _pressedWithLeftButton = false;
        if (wasClick)
        {
            var ray = (Camera ?? _fallbackCamera).CreateRay(
                releasePosition.X,
                releasePosition.Y,
                Bounds.Width,
                Bounds.Height);
            var result = _picker?.Pick(ray, Options, includeDevices: !PickProductsOnly);
            Picked?.Invoke(this, result);
        }

        e.Handled = true;
    }

    protected override void OnPointerWheelChanged(PointerWheelEventArgs e)
    {
        base.OnPointerWheelChanged(e);
        (Camera ?? _fallbackCamera).Zoom(e.Delta.Y);
        e.Handled = true;
    }

    private static Point ToPoint(Vector2 point) => new(point.X, point.Y);

    private static uint ToColorKey(Vector4 value)
    {
        var alpha = ToByte(value.W);
        var red = ToByte(value.X);
        var green = ToByte(value.Y);
        var blue = ToByte(value.Z);
        return ((uint)alpha << 24) | ((uint)red << 16) | ((uint)green << 8) | blue;
    }

    private static byte ToByte(float value) =>
        (byte)Math.Round(Math.Clamp(value, 0f, 1f) * byte.MaxValue);

    private static double DistanceSquared(Point left, Point right)
    {
        var x = left.X - right.X;
        var y = left.Y - right.Y;
        return (x * x) + (y * y);
    }

    private void OnCameraChanged(object? sender, EventArgs e) => InvalidateVisual();

    private enum DragMode
    {
        None,
        Orbit,
        Pan,
    }
}
