using System.Numerics;

namespace NodeScope.Desktop.Bim;

internal enum BimViewPreset
{
    Isometric,
    Front,
    Right,
    Top,
}

internal readonly record struct BimCameraSnapshot(
    Matrix4x4 View,
    Matrix4x4 Projection,
    Vector3 Eye,
    Vector3 Target,
    Vector3 Direction,
    Vector3 Up,
    float FieldOfViewDegrees,
    float Near,
    float Far);

/// <summary>
/// Z-up orbit camera shared by the GL control and deterministic projection tests.
/// It contains no Avalonia state and can therefore be exercised headlessly.
/// </summary>
internal sealed class BimCamera
{
    private const float DefaultFieldOfView = MathF.PI / 4f;
    private const float MinimumFieldOfView = MathF.PI / 18f;
    private const float MaximumFieldOfView = MathF.PI * 2f / 3f;
    private const float MinPitch = -MathF.PI * 0.494f;
    private const float MaxPitch = MathF.PI * 0.494f;

    private BimBounds _modelBounds = new(new Vector3(-0.5f), new Vector3(0.5f));
    private Vector3 _target;
    private float _yaw = -MathF.PI / 4f;
    private float _pitch = MathF.PI / 6f;
    private float _distance = 3f;
    private float _fieldOfView = DefaultFieldOfView;

    public event EventHandler? Changed;

    public Vector3 Target => _target;

    public float Yaw => _yaw;

    public float Pitch => _pitch;

    public float Distance => _distance;

    public float FieldOfViewDegrees => _fieldOfView * 180f / MathF.PI;

    public void Fit(BimBounds bounds)
    {
        if (!bounds.IsEmpty)
        {
            _modelBounds = bounds;
        }

        _target = _modelBounds.Center;
        _distance = FitDistance(_modelBounds.Radius);
        RaiseChanged();
    }

    public void Focus(BimBounds bounds)
    {
        if (bounds.IsEmpty)
        {
            return;
        }

        _target = bounds.Center;
        _distance = FitDistance(bounds.Radius);
        RaiseChanged();
    }

    public void SetPreset(BimViewPreset preset)
    {
        (_yaw, _pitch) = preset switch
        {
            BimViewPreset.Front => (-MathF.PI / 2f, 0f),
            BimViewPreset.Right => (0f, 0f),
            BimViewPreset.Top => (-MathF.PI / 2f, MaxPitch),
            _ => (-MathF.PI / 4f, MathF.PI / 6f),
        };
        Fit(_modelBounds);
    }

    public void Orbit(double deltaX, double deltaY)
    {
        _yaw = WrapRadians(_yaw - ((float)deltaX * 0.008f));
        _pitch = Math.Clamp(_pitch + ((float)deltaY * 0.008f), MinPitch, MaxPitch);
        RaiseChanged();
    }

    public void Pan(double deltaX, double deltaY, double viewportHeight)
    {
        if (viewportHeight <= 0)
        {
            return;
        }

        var eye = Eye();
        var forward = Vector3.Normalize(_target - eye);
        var right = Vector3.Normalize(Vector3.Cross(forward, Vector3.UnitZ));
        if (!IsFinite(right))
        {
            right = Vector3.UnitX;
        }

        var up = Vector3.Normalize(Vector3.Cross(right, forward));
        var worldPerPixel =
            (2f * _distance * MathF.Tan(_fieldOfView * 0.5f)) / (float)viewportHeight;
        _target += ((float)-deltaX * worldPerPixel * right)
            + ((float)deltaY * worldPerPixel * up);
        RaiseChanged();
    }

    /// <summary>Positive wheel deltas zoom in, negative deltas zoom out.</summary>
    public void Zoom(double wheelDelta)
    {
        var minimum = MathF.Max(_modelBounds.Radius * 0.02f, 0.001f);
        var maximum = MathF.Max(_modelBounds.Radius * 500f, minimum * 10f);
        _distance = Math.Clamp(
            _distance * MathF.Exp((float)-wheelDelta * 0.16f),
            minimum,
            maximum);
        RaiseChanged();
    }

    public void SetView(
        Vector3 position,
        Vector3 direction,
        Vector3 up,
        float? fieldOfViewDegrees)
    {
        if (!IsFinite(position)
            || !IsFinite(direction)
            || direction.LengthSquared() <= float.Epsilon)
        {
            return;
        }

        var normalizedDirection = Vector3.Normalize(direction);
        var eyeDirection = -normalizedDirection;
        _yaw = MathF.Atan2(eyeDirection.Y, eyeDirection.X);
        _pitch = Math.Clamp(
            MathF.Asin(Math.Clamp(eyeDirection.Z, -1f, 1f)),
            MinPitch,
            MaxPitch);
        _distance = MathF.Max(_distance, _modelBounds.Radius * 0.1f);
        _target = position + (normalizedDirection * _distance);
        if (fieldOfViewDegrees is { } degrees && float.IsFinite(degrees))
        {
            _fieldOfView = Math.Clamp(
                degrees * MathF.PI / 180f,
                MinimumFieldOfView,
                MaximumFieldOfView);
        }

        // The orbit controller is intentionally Z-up. BCF viewpoints whose up
        // vector is rolled are normalized to the closest stable Z-up view.
        _ = up;
        RaiseChanged();
    }

    public BimRay CreateRay(double x, double y, double width, double height)
    {
        if (!double.IsFinite(x)
            || !double.IsFinite(y)
            || !double.IsFinite(width)
            || !double.IsFinite(height)
            || width <= 0
            || height <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(width));
        }

        var snapshot = Snapshot(width / height);
        var viewProjection = snapshot.View * snapshot.Projection;
        if (!Matrix4x4.Invert(viewProjection, out var inverse))
        {
            return new BimRay(snapshot.Eye, snapshot.Direction);
        }

        var ndcX = ((float)x / (float)width * 2f) - 1f;
        var ndcY = 1f - ((float)y / (float)height * 2f);
        var near = Vector4.Transform(new Vector4(ndcX, ndcY, -1f, 1f), inverse);
        var far = Vector4.Transform(new Vector4(ndcX, ndcY, 1f, 1f), inverse);
        if (MathF.Abs(near.W) <= float.Epsilon || MathF.Abs(far.W) <= float.Epsilon)
        {
            return new BimRay(snapshot.Eye, snapshot.Direction);
        }

        var nearPoint = new Vector3(near.X, near.Y, near.Z) / near.W;
        var farPoint = new Vector3(far.X, far.Y, far.Z) / far.W;
        var direction = farPoint - nearPoint;
        return direction.LengthSquared() > float.Epsilon
            ? new BimRay(nearPoint, Vector3.Normalize(direction))
            : new BimRay(snapshot.Eye, snapshot.Direction);
    }

    public BimCameraSnapshot Snapshot(double aspectRatio)
    {
        var aspect = double.IsFinite(aspectRatio) && aspectRatio > 0
            ? (float)aspectRatio
            : 1f;
        var radius = _modelBounds.Radius;
        var near = MathF.Max(MathF.Min(_distance * 0.01f, radius * 0.05f), 0.0001f);
        var far = MathF.Max(_distance + (radius * 8f), near + 1f);
        var eye = Eye();
        var direction = Vector3.Normalize(_target - eye);
        var right = Vector3.Cross(direction, Vector3.UnitZ);
        if (right.LengthSquared() <= float.Epsilon)
        {
            right = Vector3.UnitX;
        }

        right = Vector3.Normalize(right);
        var up = Vector3.Normalize(Vector3.Cross(right, direction));
        var view = Matrix4x4.CreateLookAt(eye, _target, up);
        var projection = CreateOpenGlPerspective(aspect, near, far);
        return new BimCameraSnapshot(
            view,
            projection,
            eye,
            _target,
            direction,
            up,
            FieldOfViewDegrees,
            near,
            far);
    }

    private Vector3 Eye()
    {
        var horizontal = MathF.Cos(_pitch);
        return _target + (_distance * new Vector3(
            horizontal * MathF.Cos(_yaw),
            horizontal * MathF.Sin(_yaw),
            MathF.Sin(_pitch)));
    }

    private float FitDistance(float radius) =>
        MathF.Max((radius / MathF.Sin(_fieldOfView * 0.5f)) * 1.15f, 0.01f);

    /// <summary>
    /// System.Numerics' stock perspective matrix targets a 0..1 depth range.
    /// OpenGL clips at -1..1, so use its native right-handed projection to retain
    /// the full depth buffer and avoid close-surface shimmer in large facilities.
    /// </summary>
    private Matrix4x4 CreateOpenGlPerspective(float aspect, float near, float far)
    {
        var yScale = 1f / MathF.Tan(_fieldOfView * 0.5f);
        var xScale = yScale / aspect;
        return new Matrix4x4(
            xScale, 0, 0, 0,
            0, yScale, 0, 0,
            0, 0, (far + near) / (near - far), -1,
            0, 0, (2f * far * near) / (near - far), 0);
    }

    private static float WrapRadians(float value)
    {
        var wrapped = value % MathF.Tau;
        return wrapped is < -MathF.PI ? wrapped + MathF.Tau
            : wrapped > MathF.PI ? wrapped - MathF.Tau
            : wrapped;
    }

    private static bool IsFinite(Vector3 value) =>
        float.IsFinite(value.X)
        && float.IsFinite(value.Y)
        && float.IsFinite(value.Z);

    private void RaiseChanged() => Changed?.Invoke(this, EventArgs.Empty);
}
