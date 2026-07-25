using System.Numerics;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.OpenGL;
using Avalonia.OpenGL.Controls;
using Silk.NET.OpenGL;

namespace NodeScope.Desktop.Bim;

/// <summary>
/// Avalonia-owned OpenGL viewport. Geometry is uploaded once per scene and
/// repeated wexBIM shapes use instanced draws instead of duplicating vertices.
/// </summary>
internal sealed class OpenGlBimViewport : OpenGlControlBase
{
    private const int GeometryStrideBytes = BimGeometry.FloatsPerVertex * sizeof(float);
    private const int InstanceFloats = 20;
    private const int InstanceStrideBytes = InstanceFloats * sizeof(float);

    private readonly List<DrawBatch> _draws = [];
    private readonly BimCamera _fallbackCamera = new();
    private GL? _gl;
    private BimScene? _scene;
    private BimCamera? _camera;
    private BimRenderOptions _options = BimRenderOptions.Empty;
    private bool _sceneDirty = true;
    private uint _program;
    private uint _vertexArray;
    private uint _geometryBuffer;
    private uint _instanceBuffer;
    private int _viewUniform;
    private int _projectionUniform;
    private int _sectionPlaneUniform;
    private int _sectionEnabledUniform;
    private Point _lastPointer;
    private DragMode _dragMode;
    private bool _reportedRendererReady;

    /// <summary>
    /// Opt-in live-render diagnostic used by the WSLg E2E harness. Off by
    /// default so production frames never read pixels back from the GPU.
    /// </summary>
    internal bool CaptureDiagnostics { get; set; }

    internal BimFrameDiagnostics? LastDiagnostics { get; private set; }

    internal event EventHandler? DiagnosticFrameRendered;

    internal event EventHandler? RendererReady;

    internal event EventHandler? RendererLost;

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
            _sceneDirty = true;
            RequestNextFrameRendering();
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

            RequestNextFrameRendering();
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
            _sceneDirty = true;
            RequestNextFrameRendering();
        }
    }

    protected override void OnOpenGlInit(GlInterface gl)
    {
        _reportedRendererReady = false;
        _gl = GL.GetApi(gl.GetProcAddress);
        _program = CreateProgram(_gl, GlVersion.Type == GlProfileType.OpenGLES);
        _viewUniform = _gl.GetUniformLocation(_program, "uView");
        _projectionUniform = _gl.GetUniformLocation(_program, "uProjection");
        _sectionPlaneUniform = _gl.GetUniformLocation(_program, "uSectionPlane");
        _sectionEnabledUniform = _gl.GetUniformLocation(_program, "uSectionEnabled");
        _vertexArray = _gl.GenVertexArray();
        _geometryBuffer = _gl.GenBuffer();
        _instanceBuffer = _gl.GenBuffer();
        _sceneDirty = true;
    }

    protected override void OnOpenGlDeinit(GlInterface gl)
    {
        if (_gl is not null)
        {
            if (_instanceBuffer != 0)
            {
                _gl.DeleteBuffer(_instanceBuffer);
            }

            if (_geometryBuffer != 0)
            {
                _gl.DeleteBuffer(_geometryBuffer);
            }

            if (_vertexArray != 0)
            {
                _gl.DeleteVertexArray(_vertexArray);
            }

            if (_program != 0)
            {
                _gl.DeleteProgram(_program);
            }

            _gl.Dispose();
        }

        _gl = null;
        _program = 0;
        _vertexArray = 0;
        _geometryBuffer = 0;
        _instanceBuffer = 0;
        _draws.Clear();
        ReportRendererLost();
    }

    protected override void OnOpenGlLost()
    {
        _gl = null;
        _sceneDirty = true;
        _draws.Clear();
        ReportRendererLost();
    }

    protected override void OnOpenGlRender(GlInterface gl, int framebuffer)
    {
        if (_gl is null)
        {
            return;
        }

        _gl.BindFramebuffer(FramebufferTarget.Framebuffer, (uint)framebuffer);
        var scaling = TopLevel.GetTopLevel(this)?.RenderScaling ?? 1d;
        var width = Math.Max(1, (uint)Math.Ceiling(Bounds.Width * scaling));
        var height = Math.Max(1, (uint)Math.Ceiling(Bounds.Height * scaling));
        _gl.Viewport(0, 0, width, height);
        _gl.ClearColor(0.035f, 0.055f, 0.09f, 1f);
        _gl.Clear((uint)(ClearBufferMask.ColorBufferBit | ClearBufferMask.DepthBufferBit));

        if (_sceneDirty)
        {
            UploadScene(_gl, _scene);
            _sceneDirty = false;
        }

        if (_scene is null || _draws.Count == 0)
        {
            ReportRendererReady();
            return;
        }

        _gl.Enable(EnableCap.DepthTest);
        _gl.DepthFunc(DepthFunction.Lequal);
        _gl.Enable(EnableCap.Multisample);
        _gl.Disable(EnableCap.CullFace);
        _gl.UseProgram(_program);
        _gl.BindVertexArray(_vertexArray);

        var camera = Camera ?? _fallbackCamera;
        var snapshot = camera.Snapshot((double)width / height);
        UploadMatrix(_gl, _viewUniform, snapshot.View);
        UploadMatrix(_gl, _projectionUniform, snapshot.Projection);
        var section = Options.Section;
        var equation = section.Equation;
        _gl.Uniform4(
            _sectionPlaneUniform,
            equation.X,
            equation.Y,
            equation.Z,
            equation.W);
        _gl.Uniform1(_sectionEnabledUniform, section.Enabled ? 1 : 0);

        _gl.Disable(EnableCap.Blend);
        _gl.DepthMask(true);
        DrawPass(_gl, transparent: false);

        _gl.Enable(EnableCap.Blend);
        _gl.BlendFunc(BlendingFactor.SrcAlpha, BlendingFactor.OneMinusSrcAlpha);
        _gl.DepthMask(false);
        DrawPass(_gl, transparent: true);
        _gl.DepthMask(true);
        _gl.Disable(EnableCap.Blend);

        if (CaptureDiagnostics)
        {
            CaptureFrameDiagnostics(_gl, width, height);
        }

        ReportRendererReady();
    }

    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        base.OnPointerPressed(e);
        var point = e.GetCurrentPoint(this);
        _lastPointer = point.Position;
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
        if (_dragMode != DragMode.None)
        {
            e.Pointer.Capture(null);
            _dragMode = DragMode.None;
            e.Handled = true;
        }
    }

    protected override void OnPointerWheelChanged(PointerWheelEventArgs e)
    {
        base.OnPointerWheelChanged(e);
        (Camera ?? _fallbackCamera).Zoom(e.Delta.Y);
        e.Handled = true;
    }

    private void OnCameraChanged(object? sender, EventArgs e) => RequestNextFrameRendering();

    private void ReportRendererReady()
    {
        if (_reportedRendererReady)
        {
            return;
        }

        _reportedRendererReady = true;
        RendererReady?.Invoke(this, EventArgs.Empty);
    }

    private void ReportRendererLost()
    {
        if (!_reportedRendererReady)
        {
            return;
        }

        _reportedRendererReady = false;
        RendererLost?.Invoke(this, EventArgs.Empty);
    }

    private unsafe void CaptureFrameDiagnostics(GL api, uint width, uint height)
    {
        var pixelCount = checked((int)(width * height));
        var pixels = new byte[checked(pixelCount * 4)];
        fixed (byte* destination = pixels)
        {
            api.ReadPixels(
                0,
                0,
                width,
                height,
                PixelFormat.Rgba,
                PixelType.UnsignedByte,
                destination);
        }

        var painted = 0;
        for (var offset = 0; offset < pixels.Length; offset += 4)
        {
            if (Math.Abs(pixels[offset] - 9) > 4
                || Math.Abs(pixels[offset + 1] - 14) > 4
                || Math.Abs(pixels[offset + 2] - 23) > 4)
            {
                painted++;
            }
        }

        LastDiagnostics = new BimFrameDiagnostics(
            width,
            height,
            painted,
            api.GetError().ToString(),
            GlVersion);
        DiagnosticFrameRendered?.Invoke(this, EventArgs.Empty);
    }

    private unsafe void UploadScene(GL api, BimScene? scene)
    {
        _draws.Clear();
        api.BindVertexArray(_vertexArray);
        api.BindBuffer(BufferTargetARB.ArrayBuffer, _geometryBuffer);

        List<BimGeometry> geometries = scene is null
            ? []
            : scene.Geometries.Concat(BimDeviceMeshes.Build(scene, Options)).ToList();
        long geometryBytes = 0;
        foreach (var geometry in geometries)
        {
            geometryBytes = checked(geometryBytes + ((long)geometry.Vertices.Length * sizeof(float)));
        }

        api.BufferData(
            BufferTargetARB.ArrayBuffer,
            checked((nuint)geometryBytes),
            null,
            BufferUsageARB.StaticDraw);

        long geometryOffsetBytes = 0;
        var firstVertex = 0;
        var visibleInstanceCount = geometries.Sum(
            geometry => geometry.Instances.Count(Options.IsVisible));
        var instanceValues = new float[checked(visibleInstanceCount * InstanceFloats)];
        var instanceIndex = 0;

        foreach (var geometry in geometries)
        {
            api.BufferSubData<float>(
                BufferTargetARB.ArrayBuffer,
                checked((nint)geometryOffsetBytes),
                geometry.Vertices);
            geometryOffsetBytes = checked(
                geometryOffsetBytes + ((long)geometry.Vertices.Length * sizeof(float)));

            var opaqueStart = instanceIndex;
            foreach (var instance in geometry.Instances.Where(
                         instance =>
                             Options.IsVisible(instance)
                             && Options.Color(instance).W >= 0.996f))
            {
                WriteInstance(
                    instanceValues,
                    instanceIndex++,
                    instance,
                    Options.Color(instance));
            }

            var transparentStart = instanceIndex;
            foreach (var instance in geometry.Instances.Where(
                         instance =>
                             Options.IsVisible(instance)
                             && Options.Color(instance).W < 0.996f))
            {
                WriteInstance(
                    instanceValues,
                    instanceIndex++,
                    instance,
                    Options.Color(instance));
            }

            _draws.Add(new DrawBatch(
                firstVertex,
                geometry.VertexCount,
                opaqueStart,
                transparentStart - opaqueStart,
                transparentStart,
                instanceIndex - transparentStart));
            firstVertex = checked(firstVertex + geometry.VertexCount);
        }

        api.EnableVertexAttribArray(0);
        api.VertexAttribPointer(
            0,
            3,
            VertexAttribPointerType.Float,
            false,
            GeometryStrideBytes,
            IntPtr.Zero);
        api.EnableVertexAttribArray(1);
        api.VertexAttribPointer(
            1,
            3,
            VertexAttribPointerType.Float,
            false,
            GeometryStrideBytes,
            new IntPtr(3 * sizeof(float)));

        api.BindBuffer(BufferTargetARB.ArrayBuffer, _instanceBuffer);
        api.BufferData<float>(
            BufferTargetARB.ArrayBuffer,
            instanceValues,
            BufferUsageARB.StaticDraw);
    }

    private void DrawPass(GL api, bool transparent)
    {
        api.BindBuffer(BufferTargetARB.ArrayBuffer, _instanceBuffer);
        foreach (var draw in _draws)
        {
            var start = transparent ? draw.TransparentStart : draw.OpaqueStart;
            var count = transparent ? draw.TransparentCount : draw.OpaqueCount;
            if (count == 0 || draw.VertexCount == 0)
            {
                continue;
            }

            ConfigureInstanceAttributes(api, start);
            api.DrawArraysInstanced(
                PrimitiveType.Triangles,
                draw.FirstVertex,
                (uint)draw.VertexCount,
                (uint)count);
        }
    }

    private static void ConfigureInstanceAttributes(GL api, int instanceStart)
    {
        var baseOffset = checked(instanceStart * InstanceStrideBytes);
        for (uint column = 0; column < 4; column++)
        {
            var location = 2 + column;
            api.EnableVertexAttribArray(location);
            api.VertexAttribPointer(
                location,
                4,
                VertexAttribPointerType.Float,
                false,
                InstanceStrideBytes,
                new IntPtr(baseOffset + ((int)column * 4 * sizeof(float))));
            api.VertexAttribDivisor(location, 1);
        }

        api.EnableVertexAttribArray(6);
        api.VertexAttribPointer(
            6,
            4,
            VertexAttribPointerType.Float,
            false,
            InstanceStrideBytes,
            new IntPtr(baseOffset + (16 * sizeof(float))));
        api.VertexAttribDivisor(6, 1);
    }

    private static void WriteInstance(
        Span<float> values,
        int instanceIndex,
        BimInstance instance,
        Vector4 color)
    {
        var offset = checked(instanceIndex * InstanceFloats);
        var matrix = instance.Transform;
        values[offset] = matrix.M11;
        values[offset + 1] = matrix.M12;
        values[offset + 2] = matrix.M13;
        values[offset + 3] = matrix.M14;
        values[offset + 4] = matrix.M21;
        values[offset + 5] = matrix.M22;
        values[offset + 6] = matrix.M23;
        values[offset + 7] = matrix.M24;
        values[offset + 8] = matrix.M31;
        values[offset + 9] = matrix.M32;
        values[offset + 10] = matrix.M33;
        values[offset + 11] = matrix.M34;
        values[offset + 12] = matrix.M41;
        values[offset + 13] = matrix.M42;
        values[offset + 14] = matrix.M43;
        values[offset + 15] = matrix.M44;
        values[offset + 16] = color.X;
        values[offset + 17] = color.Y;
        values[offset + 18] = color.Z;
        values[offset + 19] = color.W;
    }

    private static void UploadMatrix(GL api, int location, Matrix4x4 matrix)
    {
        Span<float> values =
        [
            matrix.M11, matrix.M12, matrix.M13, matrix.M14,
            matrix.M21, matrix.M22, matrix.M23, matrix.M24,
            matrix.M31, matrix.M32, matrix.M33, matrix.M34,
            matrix.M41, matrix.M42, matrix.M43, matrix.M44,
        ];
        api.UniformMatrix4(location, false, values);
    }

    private static uint CreateProgram(GL api, bool isGles)
    {
        var vertex = CompileShader(api, ShaderType.VertexShader, VertexShader(isGles));
        var fragment = CompileShader(api, ShaderType.FragmentShader, FragmentShader(isGles));
        var program = api.CreateProgram();
        api.AttachShader(program, vertex);
        api.AttachShader(program, fragment);
        api.BindAttribLocation(program, 0, "aPosition");
        api.BindAttribLocation(program, 1, "aNormal");
        api.BindAttribLocation(program, 2, "iModel");
        api.BindAttribLocation(program, 6, "iColor");
        api.LinkProgram(program);
        var linked = api.GetProgram(program, ProgramPropertyARB.LinkStatus);
        var log = api.GetProgramInfoLog(program);
        api.DetachShader(program, vertex);
        api.DetachShader(program, fragment);
        api.DeleteShader(vertex);
        api.DeleteShader(fragment);
        if (linked == 0)
        {
            api.DeleteProgram(program);
            throw new InvalidOperationException($"BIM OpenGL program link failed: {log}");
        }

        return program;
    }

    private static uint CompileShader(GL api, ShaderType type, string source)
    {
        var shader = api.CreateShader(type);
        api.ShaderSource(shader, source);
        api.CompileShader(shader);
        if (api.GetShader(shader, ShaderParameterName.CompileStatus) != 0)
        {
            return shader;
        }

        var log = api.GetShaderInfoLog(shader);
        api.DeleteShader(shader);
        throw new InvalidOperationException($"BIM OpenGL shader compilation failed: {log}");
    }

    private static string VertexShader(bool isGles) => isGles
        ? """
          #version 300 es
          precision highp float;
          in vec3 aPosition;
          in vec3 aNormal;
          in mat4 iModel;
          in vec4 iColor;
          uniform mat4 uView;
          uniform mat4 uProjection;
          out vec3 vWorldPosition;
          out vec3 vNormal;
          out vec4 vColor;
          void main() {
              vec4 world = iModel * vec4(aPosition, 1.0);
              vWorldPosition = world.xyz;
              vNormal = normalize(mat3(iModel) * aNormal);
              vColor = iColor;
              gl_Position = uProjection * uView * world;
          }
          """
        : """
          #version 150
          in vec3 aPosition;
          in vec3 aNormal;
          in mat4 iModel;
          in vec4 iColor;
          uniform mat4 uView;
          uniform mat4 uProjection;
          out vec3 vWorldPosition;
          out vec3 vNormal;
          out vec4 vColor;
          void main() {
              vec4 world = iModel * vec4(aPosition, 1.0);
              vWorldPosition = world.xyz;
              vNormal = normalize(mat3(iModel) * aNormal);
              vColor = iColor;
              gl_Position = uProjection * uView * world;
          }
          """;

    private static string FragmentShader(bool isGles) => isGles
        ? """
          #version 300 es
          precision highp float;
          in vec3 vWorldPosition;
          in vec3 vNormal;
          in vec4 vColor;
          uniform vec4 uSectionPlane;
          uniform int uSectionEnabled;
          out vec4 fragmentColor;
          void main() {
              if (uSectionEnabled != 0
                  && dot(uSectionPlane, vec4(vWorldPosition, 1.0)) > 0.0) {
                  discard;
              }
              vec3 normal = normalize(gl_FrontFacing ? vNormal : -vNormal);
              vec3 light = normalize(vec3(-0.35, -0.45, 0.82));
              float diffuse = max(dot(normal, light), 0.0);
              float rim = pow(1.0 - abs(normal.z), 3.0) * 0.10;
              vec3 lit = vColor.rgb * (0.34 + 0.66 * diffuse) + vec3(rim);
              fragmentColor = vec4(lit, vColor.a);
          }
          """
        : """
          #version 150
          in vec3 vWorldPosition;
          in vec3 vNormal;
          in vec4 vColor;
          uniform vec4 uSectionPlane;
          uniform int uSectionEnabled;
          out vec4 fragmentColor;
          void main() {
              if (uSectionEnabled != 0
                  && dot(uSectionPlane, vec4(vWorldPosition, 1.0)) > 0.0) {
                  discard;
              }
              vec3 normal = normalize(gl_FrontFacing ? vNormal : -vNormal);
              vec3 light = normalize(vec3(-0.35, -0.45, 0.82));
              float diffuse = max(dot(normal, light), 0.0);
              float rim = pow(1.0 - abs(normal.z), 3.0) * 0.10;
              vec3 lit = vColor.rgb * (0.34 + 0.66 * diffuse) + vec3(rim);
              fragmentColor = vec4(lit, vColor.a);
          }
          """;

    private sealed record DrawBatch(
        int FirstVertex,
        int VertexCount,
        int OpaqueStart,
        int OpaqueCount,
        int TransparentStart,
        int TransparentCount);

    private enum DragMode
    {
        None,
        Orbit,
        Pan,
    }
}

internal sealed record BimFrameDiagnostics(
    uint Width,
    uint Height,
    int PaintedPixels,
    string GlError,
    GlVersion Version);
