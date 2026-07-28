using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Media.Imaging;
using Avalonia.Threading;
using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Bim;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using NodeScope.Desktop.Views;
using SkiaSharp;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// Headless surface coverage plus a deterministic offscreen projection of real
/// wexBIM triangles. Avalonia Headless has no GL context, so the screenshot uses
/// the renderer-independent scene and camera shared by the production viewport.
/// </summary>
public sealed class BimViewerViewTests : IDisposable
{
    private static readonly Uri Server = new("https://appliance.local/");

    private readonly FakeApplianceClient _client = new(Server);
    private BimViewerViewModel? _viewModel;

    public void Dispose()
    {
        _viewModel?.Dispose();
        _client.Dispose();
    }

    [AvaloniaFact]
    public async Task Ready_view_connects_the_parsed_scene_and_camera_to_the_viewport()
    {
        AddReadyBuilding();
        var viewModel = await CreateAsync();
        var view = new BimViewerView { DataContext = viewModel };
        var window = new Window { Width = 960, Height = 640, Content = view };
        window.Show();

        var viewport = view.FindControl<OpenGlBimViewport>("Viewport");
        var softwareViewport = view.FindControl<SoftwareBimViewport>("SoftwareViewport");
        Assert.NotNull(viewport);
        Assert.NotNull(softwareViewport);
        Assert.Same(viewModel.Scene, viewport.Scene);
        Assert.Same(viewModel.Camera, viewport.Camera);
        Assert.Same(viewModel.Scene, softwareViewport.Scene);
        Assert.Same(viewModel.Camera, softwareViewport.Camera);
        Assert.True(viewport.IsVisible);
        Assert.True(softwareViewport.IsVisible);
        Assert.True(view.FindControl<Border>("NocHud")!.IsVisible);
        Assert.False(view.FindControl<Border>("SelectionInspector")!.IsVisible);
        Assert.Single(viewModel.Categories);
        Assert.Single(viewModel.HealthDevices);
        Assert.Equal(
            viewModel.SelectedBuilding,
            view.FindControl<ComboBox>("BuildingPicker")!.SelectedItem);

        var shot = Environment.GetEnvironmentVariable("NODESCOPE_DESKTOP_BIM_VIEW_SHOT");
        if (!string.IsNullOrWhiteSpace(shot))
        {
            using var frame = window.CaptureRenderedFrame();
            Assert.NotNull(frame);
            using var encoded = new MemoryStream();
            frame.Save(encoded, PngBitmapEncoderOptions.Default);
            await File.WriteAllBytesAsync(
                shot,
                encoded.ToArray(),
                TestContext.Current.CancellationToken);
        }

        window.Content = null;
        Assert.Null(viewport.Scene);
        Assert.Null(viewport.Camera);
        Assert.Null(softwareViewport.Scene);
        Assert.Null(softwareViewport.Camera);
    }

    [AvaloniaFact]
    public async Task Empty_state_is_visible_and_explains_the_next_action()
    {
        var viewModel = await CreateAsync();
        var view = new BimViewerView { DataContext = viewModel };
        var window = new Window { Width = 960, Height = 640, Content = view };
        window.Show();

        Assert.True(view.FindControl<Border>("StatusPanel")!.IsVisible);
        Assert.Equal(
            "No buildings in scope",
            view.FindControl<TextBlock>("StatusTitle")!.Text);
        Assert.Contains(
            "Create a building",
            view.FindControl<TextBlock>("StatusMessage")!.Text,
            StringComparison.Ordinal);
    }

    [AvaloniaFact]
    public async Task Operations_tabs_render_device_telemetry_and_issue_capture()
    {
        AddReadyBuilding();
        var viewModel = await CreateAsync();
        viewModel.SelectedDevice = viewModel.Devices.Single();
        await viewModel.CurrentTelemetryLoad;
        var view = new BimViewerView { DataContext = viewModel };
        var window = new Window { Width = 960, Height = 700, Content = view };
        window.Show();
        var tabs = view.FindControl<TabControl>("OperationsTabs")!;

        tabs.SelectedIndex = 1;
        Dispatcher.UIThread.RunJobs();

        var sparkline = view.FindControl<BimSparkline>("TelemetrySparkline");
        Assert.NotNull(sparkline);
        Assert.Equal(3, sparkline.Points?.Count);
        Assert.True(view.FindControl<Border>("SelectionInspector")!.IsVisible);
        Assert.False(view.FindControl<Button>("SelectionFocusButton")!.IsEnabled);
        Assert.False(view.FindControl<Button>("DeviceFlyToButton")!.IsEnabled);
        Assert.False(view.FindControl<Button>("ClearDevicePositionButton")!.IsEnabled);
        Assert.False(view.FindControl<Button>("ClearDeviceLinkButton")!.IsEnabled);

        var shot = Environment.GetEnvironmentVariable("NODESCOPE_DESKTOP_BIM_OPERATIONS_SHOT");
        if (!string.IsNullOrWhiteSpace(shot))
        {
            using var frame = window.CaptureRenderedFrame();
            Assert.NotNull(frame);
            using var encoded = new MemoryStream();
            frame.Save(encoded, PngBitmapEncoderOptions.Default);
            await File.WriteAllBytesAsync(
                shot,
                encoded.ToArray(),
                TestContext.Current.CancellationToken);
        }

        tabs.SelectedIndex = 2;
        Dispatcher.UIThread.RunJobs();
        Assert.True(view.FindControl<Button>("CreateIssueButton")!.IsVisible);
        Assert.True(view.FindControl<StackPanel>("IssueEmptyState")!.IsVisible);
        Assert.False(view.FindControl<Button>("OpenIssueButton")!.IsEnabled);

        var issueShot = Environment.GetEnvironmentVariable("NODESCOPE_DESKTOP_BIM_ISSUES_SHOT");
        if (!string.IsNullOrWhiteSpace(issueShot))
        {
            using var frame = window.CaptureRenderedFrame();
            Assert.NotNull(frame);
            using var encoded = new MemoryStream();
            frame.Save(encoded, PngBitmapEncoderOptions.Default);
            await File.WriteAllBytesAsync(
                issueShot,
                encoded.ToArray(),
                TestContext.Current.CancellationToken);
        }
    }

    [AvaloniaFact]
    public void Software_fallback_is_fitted_centered_and_rasterizes_the_cube()
    {
        var scene = WexBimReader.Read(
            WexBimFixture.CubeA(),
            TestContext.Current.CancellationToken);
        var camera = new BimCamera();
        camera.Fit(scene.Bounds);
        var viewport = new SoftwareBimViewport { Scene = scene, Camera = camera };
        var window = new Window { Width = 512, Height = 512, Content = viewport };
        window.Show();

        using var frame = window.CaptureRenderedFrame();
        Assert.NotNull(frame);
        using var encoded = new MemoryStream();
        frame.Save(encoded, PngBitmapEncoderOptions.Default);
        var png = encoded.ToArray();
        var shot = Environment.GetEnvironmentVariable("NODESCOPE_DESKTOP_BIM_SHOT");
        if (!string.IsNullOrWhiteSpace(shot))
        {
            File.WriteAllBytes(shot, png);
        }

        using var bitmap = SKBitmap.Decode(png);
        Assert.NotNull(bitmap);

        var bounds = PaintedBounds(bitmap);
        Assert.True(bounds.Count > 10_000, $"expected a substantial rendered model, got {bounds.Count} pixels");
        Assert.InRange(bounds.MinX, 20, 220);
        Assert.InRange(bounds.MaxX, 292, 492);
        Assert.InRange(bounds.MinY, 20, 220);
        Assert.InRange(bounds.MaxY, 292, 492);
    }

    private async Task<BimViewerViewModel> CreateAsync()
    {
        _viewModel = new BimViewerViewModel(
            new ApplianceSession(_client, "token-1"),
            NullLogger<BimViewerViewModel>.Instance,
            new FakeIfcTessellator());
        await _viewModel.Initialization;
        return _viewModel;
    }

    private void AddReadyBuilding()
    {
        _client.Properties.Add(new PropertySummary("b1", null, "BUILDING", "HQ", "01"));
        _client.BuildingModels["b1"] =
            new BuildingModelSummary("m1", "b1", "HQ model", "v1", null, 1);
        _client.BuildingGeometry["b1"] = WexBimFixture.CubeA();
        var productLabel = WexBimReader.Read(
            _client.BuildingGeometry["b1"],
            TestContext.Current.CancellationToken).Products.Keys.Single();
        _client.BuildingMetadata["b1"] = new BuildingModelMetadataSummary(
            "v1",
            1,
            [
                new BuildingModelElementMetadata(
                    productLabel,
                    "0ABCDEFGHIJKLMNOPQRSTU",
                    "IfcWall",
                    "North service wall"),
            ]);
        _client.BimDevices.Add(new BimDevice(
            "d1",
            "network-1",
            "b1",
            null,
            null,
            "Distribution switch",
            "SWITCH",
            null,
            null,
            1,
            "Level 1",
            null,
            null,
            null,
            null,
            "10.0.0.10",
            null,
            null,
            1,
            DateTime.UtcNow,
            DateTime.UtcNow));
        _client.BimDeviceStatuses.Add(new BimDeviceStatus(
            "d1",
            "WARNING",
            23.5,
            DateTime.UtcNow,
            DateTime.UtcNow,
            DateTime.UtcNow));
        _client.MetricNames["d1"] = ["latency_ms"];
        _client.Metrics[("d1", "latency_ms")] =
        [
            new BimMetricPoint(DateTime.UtcNow.AddMinutes(-2), 16),
            new BimMetricPoint(DateTime.UtcNow.AddMinutes(-1), 31),
            new BimMetricPoint(DateTime.UtcNow, 23.5),
        ];
        _client.StatusEvents["d1"] =
        [
            new BimStatusEvent(DateTime.UtcNow, "WARNING", "icmp"),
        ];
    }

    private static PaintedPixelBounds PaintedBounds(SKBitmap bitmap)
    {
        var result = new PaintedPixelBounds(bitmap.Width, bitmap.Height, 0, 0, 0);
        for (var x = 0; x < bitmap.Width; x++)
        {
            for (var y = 0; y < bitmap.Height; y++)
            {
                if (bitmap.GetPixel(x, y) == new SKColor(9, 16, 29))
                {
                    continue;
                }

                result = result with
                {
                    MinX = Math.Min(result.MinX, x),
                    MinY = Math.Min(result.MinY, y),
                    MaxX = Math.Max(result.MaxX, x),
                    MaxY = Math.Max(result.MaxY, y),
                    Count = result.Count + 1,
                };
            }
        }

        return result;
    }

    private sealed record PaintedPixelBounds(
        int MinX,
        int MinY,
        int MaxX,
        int MaxY,
        int Count);
}
