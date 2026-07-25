using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Mapsui;
using Mapsui.Rendering;
using Mapsui.Rendering.Skia;
using Mapsui.Projections;
using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using NodeScope.Desktop.Views;
using SkiaSharp;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// The map view on the headless platform (Decision 18): control wiring, banner and
/// panel visibility, and an offscreen screenshot proving the overlay layers draw.
/// </summary>
public sealed class MapViewTests : IDisposable
{
    private static readonly Uri Server = new("https://appliance.local/");

    private readonly FakeApplianceClient _client = new(Server);
    private MapViewModel? _viewModel;

    public void Dispose()
    {
        _viewModel?.Dispose();
        _client.Dispose();
    }

    private async Task<MapViewModel> CreateViewModelAsync()
    {
        _viewModel = new MapViewModel(
            new ApplianceSession(_client, "token-1"),
            new CurrentUser("user-1", "owner@acme.test", "Owner"),
            NullLogger<MapViewModel>.Instance,
            new ImmediateTimeProvider());
        await _viewModel.Initialization;
        return _viewModel;
    }

    [AvaloniaFact]
    public async Task The_view_hands_the_view_models_map_to_the_map_control()
    {
        var viewModel = await CreateViewModelAsync();
        var view = new MapView { DataContext = viewModel };
        var window = new Window { Content = view };
        window.Show();

        var mapControl = view.FindControl<Mapsui.UI.Avalonia.MapControl>("MapHost");
        Assert.NotNull(mapControl);
        Assert.Same(viewModel.SharedMap, mapControl.Map);
    }

    [AvaloniaFact]
    public async Task The_tiles_banner_shows_when_the_region_extract_is_missing()
    {
        _client.TilesAvailable = false;
        var viewModel = await CreateViewModelAsync();
        var view = new MapView { DataContext = viewModel };
        var window = new Window { Content = view };
        window.Show();

        Assert.True(view.FindControl<Border>("TilesBanner")!.IsVisible);
    }

    [AvaloniaFact]
    public async Task The_detail_panel_follows_the_selection()
    {
        _client.Devices.Add(new MapDevice(
            "a", "Core Router", "ROUTER", 40.7128, -74.006, 1, null, "192.168.1.1"));
        var viewModel = await CreateViewModelAsync();
        var view = new MapView { DataContext = viewModel };
        var window = new Window { Content = view };
        window.Show();

        var panel = view.FindControl<Border>("DetailPanel")!;
        Assert.False(panel.IsVisible);

        viewModel.SelectDeviceById("a");
        Assert.True(panel.IsVisible);
        Assert.Equal("Core Router", view.FindControl<TextBlock>("DetailName")!.Text);

        viewModel.ClearSelectionCommand.Execute(null);
        Assert.False(panel.IsVisible);
    }

    /// <summary>
    /// The Decision 15/18 offscreen render: markers and fiber lines rasterize without a
    /// display or a tile server (base tiles simply don't resolve against the fake host).
    /// </summary>
    [AvaloniaFact]
    public async Task Offscreen_screenshot_draws_markers_and_fiber_lines()
    {
        _client.Devices.AddRange([
            new MapDevice("a", "OLT", "ONT", 40.7128, -74.006, null, null, null),
            new MapDevice("b", "ONT 2", "ONT", 40.7148, -74.002, null, null, null),
        ]);
        _client.FiberRuns.Add(new MapFiberRun("f1", "Main", "a", "b"));
        var viewModel = await CreateViewModelAsync();

        // Navigate like the control would: size the viewport, aim it at the devices.
        // CurrentZoom then follows the viewport, so the z16 marker gates open for real.
        var (x, y) = SphericalMercator.FromLonLat(-74.004, 40.7138);
        viewModel.SharedMap.Navigator.SetSize(512, 512);
        viewModel.SharedMap.Navigator.CenterOnAndZoomTo(
            new MPoint(x, y), MapViewModel.ZoomToResolution(16));
        await viewModel.LoadViewportAsync();

        var viewport = new Viewport(x, y, MapViewModel.ZoomToResolution(16), 0, 512, 512);

        using var renderService = new RenderService();
        using var stream = new MapRenderer().RenderToBitmapStream(
            viewport,
            viewModel.SharedMap.Layers,
            renderService,
            viewModel.SharedMap.BackColor,
            1f,
            viewModel.SharedMap.Widgets,
            RenderFormat.Png,
            90);
        using var bitmap = SKBitmap.Decode(stream.ToArray());

        Assert.True(CountPixels(bitmap, IsMarkerBlue) > 100, "expected the ONT marker fill");
        Assert.True(CountPixels(bitmap, IsFiberOrange) > 10, "expected the dashed fiber line");
    }

    /// <summary>The ONT/ISP marker fill #1d4ed8 (solid circle interior survives AA).</summary>
    private static bool IsMarkerBlue(SKColor color) =>
        color is { Red: 29, Green: 78, Blue: 216 };

    /// <summary>#f97316 at 0.8 layer opacity over the page background.</summary>
    private static bool IsFiberOrange(SKColor color) =>
        color.Red > 200 && color.Green is > 100 and < 180 && color.Blue < 100;

    private static int CountPixels(SKBitmap bitmap, Func<SKColor, bool> predicate)
    {
        var count = 0;
        for (var px = 0; px < bitmap.Width; px++)
        {
            for (var py = 0; py < bitmap.Height; py++)
            {
                if (predicate(bitmap.GetPixel(px, py)))
                {
                    count++;
                }
            }
        }

        return count;
    }
}
