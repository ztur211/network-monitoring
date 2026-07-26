using Mapsui;
using Mapsui.Extensions;
using Mapsui.Projections;
using Mapsui.Rendering;
using Mapsui.Rendering.Skia;
using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Auth;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using SkiaSharp;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// The whole Decision 15 stack, live: the real desktop client code signs in natively,
/// the map view model loads the demo seed's NYC devices through the
/// appliance API, fetches liberty tiles rasterized by tileserver-gl through Caddy, and
/// the composed frame is rendered offscreen and pixel-checked.
/// </summary>
/// <remarks>
/// Env-gated: bring up the appliance stack with the demo seed
/// (deploy/docker-compose.prod.yml + build + demo overlays, region extract built) and run with
/// <c>NODESCOPE_DESKTOP_MAP_E2E_BASE_URL=http://localhost:8080</c>. The seeded owner
/// credentials default to the demo overlay's; override with
/// <c>NODESCOPE_DESKTOP_MAP_E2E_EMAIL</c>/<c>…_PASSWORD</c>. Set
/// <c>NODESCOPE_DESKTOP_MAP_E2E_SHOT=/path/shot.png</c> to keep the rendered frame.
/// </remarks>
[Collection(LiveApplianceSuite.Name)]
public sealed class MapE2ETests : IDisposable
{
    private readonly DirectoryInfo _scratch = Directory.CreateTempSubdirectory("nodescope-map-e2e-");

    public void Dispose() => _scratch.Delete(recursive: true);

    [Fact]
    public async Task The_map_loads_demo_devices_and_renders_appliance_tiles()
    {
        if (OperatingSystem.IsWindows())
        {
            Assert.Skip("the E2E drives the Linux dev-loop vault; Windows runs use DPAPI");
            return;
        }

        var configured = Environment.GetEnvironmentVariable("NODESCOPE_DESKTOP_MAP_E2E_BASE_URL");
        Assert.SkipWhen(string.IsNullOrEmpty(configured),
            "set NODESCOPE_DESKTOP_MAP_E2E_BASE_URL (appliance stack + demo seed + region extract) to run");

        var server = new Uri(configured);
        var email = Environment.GetEnvironmentVariable("NODESCOPE_DESKTOP_MAP_E2E_EMAIL") ?? "owner@acme.test";
        var password = Environment.GetEnvironmentVariable("NODESCOPE_DESKTOP_MAP_E2E_PASSWORD") ?? "devpassword123";

        // The real client code signs in as the seeded demo owner (shared across suites).
        var vault = new PlainFileTokenVault(Path.Combine(_scratch.FullName, "vault.json"));
        var settings = new SettingsStore(Path.Combine(_scratch.FullName, "settings.json"));
        using var factory = new ApplianceClientFactory();
        using var flow = new DesktopAuthFlow(factory, vault, settings, NullLogger<DesktopAuthFlow>.Instance);

        await LiveSignIn.RestoreAsync(flow, vault, server, email, password);
        Assert.Equal(SessionPhase.SignedIn, flow.Current.Phase);
        Assert.NotNull(flow.Session);

        using var realtime = new FakeRealtimeConnection();
        using var map = new MapViewModel(
            flow.Session, flow.Current.User!, NullLogger<MapViewModel>.Instance, realtime);
        await map.Initialization;

        // The appliance must serve the rasterized style (region extract built at install).
        Assert.False(map.TilesUnavailable, "the appliance did not serve /tiles/styles/liberty");

        // Aim at the demo seed's Lower-Manhattan devices. z19: every gate is open AND
        // the seeded devices (meters apart) separate into distinct markers on screen.
        var (x, y) = SphericalMercator.FromLonLat(-74.006, 40.7129);
        var resolution = MapViewModel.ZoomToResolution(19);
        map.SharedMap.Navigator.SetSize(1024, 768);
        map.SharedMap.Navigator.CenterOnAndZoomTo(new MPoint(x, y), resolution);
        await map.LoadViewportAsync();

        Assert.True(
            map.DeviceLayer.Features.Count() >= 5,
            $"expected the 5 demo devices, saw {map.DeviceLayer.Features.Count()}");

        // Let the tile layers fetch from the appliance, then compose the frame.
        var viewport = new Viewport(x, y, resolution, 0, 1024, 768);
        await map.SharedMap.RefreshDataAsync(viewport);
        await map.SharedMap.Layers.WaitForLoadingAsync();

        using var renderService = new RenderService();
        using var stream = new MapRenderer().RenderToBitmapStream(
            viewport, map.SharedMap.Layers, renderService, map.SharedMap.BackColor,
            1f, map.SharedMap.Widgets, RenderFormat.Png, 90);
        var png = stream.ToArray();

        if (Environment.GetEnvironmentVariable("NODESCOPE_DESKTOP_MAP_E2E_SHOT") is { Length: > 0 } shot)
        {
            await File.WriteAllBytesAsync(shot, png, TestContext.Current.CancellationToken);
        }

        using var bitmap = SKBitmap.Decode(png);

        // Marker fills prove the overlay: the demo seeds router/firewall (#4f46e5 indigo),
        // switch/AP (#0d9488 teal) and a server rack (#7c3aed violet) in the viewport.
        Assert.True(CountPixels(bitmap, c => c is { Red: 79, Green: 70, Blue: 229 }) > 50,
            "expected core-infrastructure marker fills");
        Assert.True(CountPixels(bitmap, c => c is { Red: 13, Green: 148, Blue: 136 }) > 50,
            "expected network-equipment marker fills");
        Assert.True(CountPixels(bitmap, c => c is { Red: 124, Green: 58, Blue: 237 }) > 50,
            "expected the server-rack marker fill");

        // The basemap check must catch the wrong-tile failure mode (world tile repeated
        // in every slot), so it asserts Manhattan CONTENT: the City Hall building mass.
        // The baked override hsl(35,12%,78%) composes through building-3d's 0.8
        // extrusion opacity to (216,213,202) at this fixed viewport (measured).
        Assert.True(
            CountPixels(bitmap, c =>
                Math.Abs(c.Red - 216) <= 4 && Math.Abs(c.Green - 213) <= 4 && Math.Abs(c.Blue - 202) <= 4) > 1000,
            "expected rendered Manhattan buildings from the appliance tiles");
    }

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
