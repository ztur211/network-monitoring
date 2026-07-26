using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Map;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// The map's ported behaviors, tested against the fake appliance: the five marker
/// gates, derived fiber lines, the two-style buildings toggle, floor options, and
/// the shared-preferences shape - all web-map parity contracts.
/// </summary>
public sealed class MapViewModelTests : IDisposable
{
    private static readonly Uri Server = new("https://appliance.local/");

    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private readonly FakeApplianceClient _client = new(Server);
    private readonly FakeRealtimeConnection _realtime = new();
    private MapViewModel? _viewModel;

    public void Dispose()
    {
        _viewModel?.Dispose();
        _client.Dispose();
        _realtime.Dispose();
    }

    private async Task<MapViewModel> CreateAsync(CurrentUser? user = null)
    {
        _viewModel = new MapViewModel(
            new ApplianceSession(_client, "token-1"),
            user ?? new CurrentUser("user-1", "owner@acme.test", "Owner"),
            NullLogger<MapViewModel>.Instance,
            _realtime,
            new ImmediateTimeProvider());
        await _viewModel.Initialization;
        return _viewModel;
    }

    private static MapDevice Device(
        string id, string category, double? lat = 40.7128, double? lon = -74.006, int? floor = null) =>
        new(id, $"Device {id}", category, lat, lon, floor, null, "192.168.1.1");

    // --- zoom / projection helpers -----------------------------------------

    [Theory]
    [InlineData(0)]
    [InlineData(13)]
    [InlineData(18.5)]
    public void Zoom_and_resolution_convert_round_trip(double zoom) =>
        Assert.Equal(zoom, MapViewModel.ResolutionToZoom(MapViewModel.ZoomToResolution(zoom)), 9);

    [Theory]
    [InlineData(0, "Ground")]
    [InlineData(3, "Floor 3")]
    [InlineData(-1, "B1")]
    public void Floor_labels_match_the_web_formatting(int floor, string expected) =>
        Assert.Equal(expected, MapViewModel.FloorLabel(floor));

    [Fact]
    public void Bbox_serializes_west_south_east_north()
    {
        var bbox = new MapBbox(-74.28, 40.48, -73.65, 40.95);
        Assert.Equal("-74.28,40.48,-73.65,40.95", bbox.ToString());
    }

    // --- initialization ----------------------------------------------------

    [Fact]
    public async Task Initialization_seeds_the_fleet_and_derives_floor_options()
    {
        _client.Devices.AddRange([
            Device("a", "ROUTER", floor: 2),
            Device("b", "SWITCH", floor: 0),
            Device("c", "ONT"),
        ]);

        var viewModel = await CreateAsync();

        Assert.Equal(
            ["All floors", "Ground", "Floor 2"],
            viewModel.FloorOptions.Select(o => o.Label));
        Assert.True(viewModel.HasFloors);
    }

    [Fact]
    public async Task A_missing_region_extract_raises_the_tiles_banner()
    {
        _client.TilesAvailable = false;
        var viewModel = await CreateAsync();
        Assert.True(viewModel.TilesUnavailable);
    }

    [Fact]
    public async Task Stored_preferences_apply_toggles_floor_mode_and_buildings()
    {
        _client.StoredPreferences = JsonSerializer.SerializeToElement(new
        {
            buildingsVisible = false,
            layerToggles = new Dictionary<string, bool> { ["ROUTER"] = false },
            mapCenter = new[] { -74.006, 40.7128 },
            mapZoom = 15.5,
            selectedFloor = 2,
            floorDisplayMode = "single",
        });

        var viewModel = await CreateAsync();

        Assert.False(viewModel.BuildingsVisible);
        Assert.False(viewModel.Categories.Single(t => t.Info.Category == "ROUTER").IsEnabled);
        Assert.Equal(2, viewModel.SelectedFloor);
        Assert.Equal(FloorDisplayMode.Single, viewModel.FloorMode);
        Assert.Equal(15.5, viewModel.CurrentZoom, 3);
        Assert.False(viewModel.LibertyLayer.Enabled);
        Assert.True(viewModel.NoBuildingsLayer.Enabled);
    }

    [Fact]
    public async Task Without_preferences_the_camera_falls_back_to_the_users_home_at_z13()
    {
        var viewModel = await CreateAsync(
            new CurrentUser("user-1", "owner@acme.test", "Owner", 40.7128, -74.006));
        Assert.Equal(13, viewModel.CurrentZoom, 3);
    }

    // --- marker gating (web parity: coords, zoom, toggle, floor) -----------

    [Fact]
    public async Task Markers_require_coordinates()
    {
        _client.Devices.AddRange([Device("a", "ROUTER"), Device("b", "ROUTER", lat: null, lon: null)]);
        var viewModel = await CreateAsync();

        viewModel.CurrentZoom = 16;

        Assert.Single(viewModel.DeviceLayer.Features);
    }

    [Fact]
    public async Task Markers_respect_the_category_zoom_gates()
    {
        _client.Devices.AddRange([
            Device("isp", "ONT"),       // z10+
            Device("core", "ROUTER"),   // z13+
            Device("net", "SWITCH"),    // z16+
            Device("edge", "COMPUTER"), // z18+
        ]);
        var viewModel = await CreateAsync();

        viewModel.CurrentZoom = 9;
        Assert.Empty(viewModel.DeviceLayer.Features);

        viewModel.CurrentZoom = 13.5;
        Assert.Equal(2, viewModel.DeviceLayer.Features.Count());

        viewModel.CurrentZoom = 18;
        Assert.Equal(4, viewModel.DeviceLayer.Features.Count());
    }

    [Fact]
    public async Task A_disabled_category_toggle_hides_its_markers()
    {
        _client.Devices.AddRange([Device("a", "ROUTER"), Device("b", "SWITCH")]);
        var viewModel = await CreateAsync();
        viewModel.CurrentZoom = 18;

        viewModel.Categories.Single(t => t.Info.Category == "SWITCH").IsEnabled = false;

        Assert.Single(viewModel.DeviceLayer.Features);
    }

    [Fact]
    public async Task Single_floor_mode_filters_markers_to_the_selected_floor()
    {
        _client.Devices.AddRange([Device("a", "ROUTER", floor: 1), Device("b", "ROUTER", floor: 2)]);
        var viewModel = await CreateAsync();
        viewModel.CurrentZoom = 16;

        viewModel.SelectedFloor = 1;
        viewModel.FloorMode = FloorDisplayMode.Single;
        Assert.Single(viewModel.DeviceLayer.Features);

        // Non-single modes keep every floor visible (other floors dim instead).
        viewModel.FloorMode = FloorDisplayMode.All;
        Assert.Equal(2, viewModel.DeviceLayer.Features.Count());
    }

    // --- fiber runs --------------------------------------------------------

    [Fact]
    public async Task Fiber_lines_join_endpoint_devices_and_drop_unplaced_runs()
    {
        _client.Devices.AddRange([
            Device("a", "ROUTER"),
            Device("b", "SWITCH", lat: 40.714, lon: -74.005),
            Device("unplaced", "SWITCH", lat: null, lon: null),
        ]);
        _client.FiberRuns.AddRange([
            new MapFiberRun("f1", "Main", "a", "b"),
            new MapFiberRun("f2", "Dangling", "a", "unplaced"),
            new MapFiberRun("f3", "Unknown", "a", "ghost"),
        ]);
        var viewModel = await CreateAsync();

        // Fiber runs arrive with the viewport load pair, like the web's moveend fetch.
        viewModel.SharedMap.Navigator.SetSize(512, 512);
        await viewModel.LoadViewportAsync();

        Assert.Single(viewModel.FiberLayer.Features);
        Assert.NotEmpty(_client.FiberBboxRequests);
        Assert.NotEmpty(_client.DeviceBboxRequests);
    }

    // --- buildings toggle --------------------------------------------------

    [Fact]
    public async Task The_buildings_toggle_swaps_the_rendered_style_layers()
    {
        var viewModel = await CreateAsync();
        Assert.True(viewModel.LibertyLayer.Enabled);
        Assert.False(viewModel.NoBuildingsLayer.Enabled);

        viewModel.BuildingsVisible = false;

        Assert.False(viewModel.LibertyLayer.Enabled);
        Assert.True(viewModel.NoBuildingsLayer.Enabled);
    }

    // --- selection ---------------------------------------------------------

    [Fact]
    public async Task Selecting_a_device_surfaces_its_details_and_clears_again()
    {
        _client.Devices.Add(Device("a", "ROUTER", floor: 2));
        var viewModel = await CreateAsync();
        viewModel.CurrentZoom = 16;

        viewModel.SelectDeviceById("a");

        Assert.Equal("Device a", viewModel.SelectedDevice?.Name);
        Assert.Equal("Router", viewModel.SelectedDeviceCategory);
        Assert.Equal("Floor 2", viewModel.SelectedDeviceFloor);

        viewModel.ClearSelectionCommand.Execute(null);
        Assert.Null(viewModel.SelectedDevice);
    }

    // --- preferences shape -------------------------------------------------

    [Fact]
    public async Task Built_preferences_use_the_web_wire_shape()
    {
        var viewModel = await CreateAsync();
        viewModel.BuildingsVisible = false;
        viewModel.SelectedFloor = 1;

        var json = JsonSerializer.SerializeToElement(viewModel.BuildPreferences(), Web);

        Assert.False(json.GetProperty("buildingsVisible").GetBoolean());
        Assert.Equal(1, json.GetProperty("selectedFloor").GetInt32());
        Assert.Equal("all", json.GetProperty("floorDisplayMode").GetString());
        Assert.True(json.GetProperty("layerToggles").GetProperty("ROUTER").GetBoolean());
    }

    // --- realtime deltas ---------------------------------------------------

    private static BimDevice PushedDevice(
        string id, string name, double? lat = 40.7128, double? lon = -74.006, int? floor = null) =>
        new(id, "n1", "bldg-1", null, null, name, "ROUTER", lat, lon, floor, null,
            null, null, null, null, null, null, null, 2, DateTime.UtcNow, DateTime.UtcNow);

    [Fact]
    public async Task A_pushed_device_update_moves_the_marker_and_refreshes_the_selection()
    {
        _client.Devices.Add(Device("a", "ROUTER"));
        var viewModel = await CreateAsync();
        viewModel.CurrentZoom = 16;
        viewModel.SelectDeviceById("a");

        _realtime.RaiseDeviceUpdated(new NodeScope.Desktop.Realtime.DeviceUpdatedEvent(
            PushedDevice("a", "Renamed Router", floor: 3)));

        Assert.Equal("Renamed Router", viewModel.SelectedDevice?.Name);
        Assert.Contains(viewModel.FloorOptions, option => option.Floor == 3);
        Assert.Single(viewModel.DeviceLayer.Features);
    }

    [Fact]
    public async Task A_pushed_update_for_an_unseen_device_joins_the_cache()
    {
        var viewModel = await CreateAsync();
        viewModel.CurrentZoom = 16;

        _realtime.RaiseDeviceUpdated(new NodeScope.Desktop.Realtime.DeviceUpdatedEvent(
            PushedDevice("late", "Late Router")));

        Assert.Single(viewModel.DeviceLayer.Features);
        viewModel.SelectDeviceById("late");
        Assert.Equal("Late Router", viewModel.SelectedDevice?.Name);
    }

    [Fact]
    public async Task A_pushed_delete_drops_the_marker_and_clears_its_selection()
    {
        _client.Devices.Add(Device("a", "ROUTER"));
        var viewModel = await CreateAsync();
        viewModel.CurrentZoom = 16;
        viewModel.SelectDeviceById("a");

        _realtime.RaiseDeviceDeleted(new NodeScope.Desktop.Realtime.DeviceDeletedEvent("a"));

        Assert.Null(viewModel.SelectedDevice);
        Assert.Empty(viewModel.DeviceLayer.Features);
    }

    // --- live pulse marker -------------------------------------------------

    [Fact]
    public async Task The_pulse_sits_on_the_users_home_and_needs_one()
    {
        var without = await CreateAsync();
        Assert.Empty(without.LiveLayer.Features);
        without.Dispose();

        var with = await CreateAsync(
            new CurrentUser("user-1", "owner@acme.test", "Owner", 40.7128, -74.006));
        var feature = Assert.Single(with.LiveLayer.Features);
        // Halo + dot, no badge until a metrics push arrives.
        Assert.Equal(2, feature.Styles.Count);
    }

    [Fact]
    public async Task A_metrics_push_adds_the_stats_badge()
    {
        var viewModel = await CreateAsync(
            new CurrentUser("user-1", "owner@acme.test", "Owner", 40.7128, -74.006));

        _realtime.RaiseMetricsUpdate(new NodeScope.Desktop.Realtime.MetricsUpdateEvent(
            new ClientMetrics(250.4, 25.6, 17.6, null, DateTime.UtcNow), ["browser"]));

        var feature = Assert.Single(viewModel.LiveLayer.Features);
        // Mapsui's LabelStyle.Text is write-only; the exact badge text is covered by
        // the FormatLiveStats theory below - here the badge style must have appeared.
        Assert.Equal(3, feature.Styles.Count);
        Assert.IsType<Mapsui.Styles.LabelStyle>(feature.Styles.Last());
    }

    [Theory]
    [InlineData(17.6, 250.4, 25.6, "18 ms · ↓250 · ↑26")]
    [InlineData(null, 250.4, null, "↓250")]
    [InlineData(12.0, null, null, "12 ms")]
    public void Live_stats_format_matches_the_web_marker(
        double? latency, double? down, double? up, string expected) =>
        Assert.Equal(expected, MapViewModel.FormatLiveStats(
            new ClientMetrics(down, up, latency, null, DateTime.UtcNow)));

    [Fact]
    public void Absent_metrics_render_no_badge() =>
        Assert.Null(MapViewModel.FormatLiveStats(null));
}
