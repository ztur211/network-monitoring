using System.Globalization;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mapsui;
using Mapsui.Extensions;
using Mapsui.Layers;
using Mapsui.Nts;
using Mapsui.Projections;
using Mapsui.Styles;
using Mapsui.Tiling.Layers;
using Microsoft.Extensions.Logging;
using NetTopologySuite.Geometries;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Map;
using NodeScope.Desktop.Realtime;
using Color = Mapsui.Styles.Color;

namespace NodeScope.Desktop.ViewModels;

/// <summary>How the floor filter treats markers on other floors (web parity).</summary>
internal enum FloorDisplayMode
{
    /// <summary>Show every floor; other floors dim when one is selected. Label "All".</summary>
    All,

    /// <summary>Show only the selected floor. Label "One".</summary>
    Single,

    /// <summary>Manual per-connection mode carried over from the web UI. Label "Manual".</summary>
    Connection,
}

/// <summary>One category checkbox in the layers panel.</summary>
[INotifyPropertyChanged]
internal sealed partial class CategoryToggle(DeviceCategoryInfo info)
{
    [ObservableProperty]
    private bool _isEnabled = true;

    public DeviceCategoryInfo Info { get; } = info;

    /// <summary>The "z13+" hint shown while the map is zoomed out past the category's gate.</summary>
    public string ZoomHint => $"z{Info.MinZoom}+";
}

/// <summary>One entry in the floor selector; <c>null</c> floor means "All floors".</summary>
internal sealed record FloorOption(int? Floor, string Label);

/// <summary>One labeled group of category checkboxes in the layers panel.</summary>
internal sealed record CategoryGroup(string Name, IReadOnlyList<CategoryToggle> Toggles);

/// <summary>
/// The GIS map (Decision 15): appliance-rasterized liberty tiles composited with native
/// overlay layers for device markers and fiber runs. A port of the web map's behavior -
/// bbox loading on viewport settle, zoom/category/floor marker gating, buildings toggle
/// (two server styles instead of a style-layer flip), shared map preferences.
/// </summary>
[INotifyPropertyChanged]
internal sealed partial class MapViewModel : IDisposable
{
    /// <summary>Web parity: viewport loads settle for 300 ms before hitting the API.</summary>
    internal static readonly TimeSpan ViewportDebounce = TimeSpan.FromMilliseconds(300);

    /// <summary>Web parity: preference writes settle for 500 ms.</summary>
    internal static readonly TimeSpan PreferencesDebounce = TimeSpan.FromMilliseconds(500);

    private const double BaseResolution = 156543.03392804097; // 3857 resolution at z0

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly ApplianceSession _session;
    private readonly CurrentUser _user;
    private readonly ILogger<MapViewModel> _logger;
    private readonly TimeProvider _time;
    private readonly CancellationTokenSource _lifetime = new();

    private readonly TileLayer _libertyLayer;
    private readonly TileLayer _noBuildingsLayer;
    private readonly MemoryLayer _fiberLayer;
    private readonly MemoryLayer _deviceLayer;
    private readonly MemoryLayer _liveLayer;
    private readonly IDisposable _deviceUpdatedSubscription;
    private readonly IDisposable _deviceDeletedSubscription;
    private readonly IDisposable _metricsSubscription;
    private readonly IDisposable _reconnectedSubscription;

    /// <summary>Every device ever loaded (fleet seed + viewport merges), like the web store.</summary>
    private readonly Dictionary<string, MapDevice> _devices = new(StringComparer.Ordinal);

    private IReadOnlyList<MapFiberRun> _fiberRuns = [];

    /// <summary>The last pushed metrics sample; feeds the live marker's stats badge.</summary>
    private ClientMetrics? _liveMetrics;
    private CancellationTokenSource? _viewportDebounce;
    private CancellationTokenSource? _viewportLoad;
    private CancellationTokenSource? _preferencesDebounce;
    private bool _applyingPreferences;

    private ConfigureScope? _scope;
    private IReadOnlyList<PropertySummary> _properties = [];
    private string? _networkId;

    /// <summary>Set while an edit form waits for a "pick new location" tap to come back.</summary>
    private DeviceFormViewModel? _relocatingForm;

    [ObservableProperty]
    private double _currentZoom;

    [ObservableProperty]
    private bool _buildingsVisible = true;

    [ObservableProperty]
    private int? _selectedFloor;

    [ObservableProperty]
    private FloorDisplayMode _floorMode = FloorDisplayMode.All;

    [ObservableProperty]
    private MapDevice? _selectedDevice;

    [ObservableProperty]
    private IReadOnlyList<FloorOption> _floorOptions = [];

    /// <summary>The floor list's selection; syncs to <see cref="SelectedFloor"/>.</summary>
    [ObservableProperty]
    private FloorOption? _selectedFloorOption;

    /// <summary>Whether the layers panel is expanded (collapsed by default, like the web).</summary>
    [ObservableProperty]
    private bool _layersExpanded;

    /// <summary>Set when the appliance has no rendered style yet (region extract not built).</summary>
    [ObservableProperty]
    private bool _tilesUnavailable;

    /// <summary>Whether the caller may place devices at all (F3 verdict; gates the FAB).</summary>
    [ObservableProperty]
    private bool _canConfigure;

    /// <summary>Placement mode: the next map tap places a device instead of selecting one.</summary>
    [ObservableProperty]
    private bool _isPlacing;

    /// <summary>The device create/edit form shown over the map, when open.</summary>
    [ObservableProperty]
    private DeviceFormViewModel? _deviceForm;

    /// <summary>Two-step delete state of the selected-device panel.</summary>
    [ObservableProperty]
    private bool _confirmingSelectedDelete;

    /// <summary>A failed mutation (delete rollback); dismissable.</summary>
    [ObservableProperty]
    private string? _operationError;

    [ObservableProperty]
    private string? _dataError;

    public MapViewModel(
        ApplianceSession session,
        CurrentUser user,
        ILogger<MapViewModel> logger,
        IRealtimeConnection realtime,
        TimeProvider? timeProvider = null)
    {
        _session = session;
        _user = user;
        _logger = logger;
        _time = timeProvider ?? TimeProvider.System;

        // Both base styles stay in the map; the buildings toggle flips Enabled. Raster
        // tiles cannot flip one style layer, so the appliance renders both variants.
        _libertyLayer = new TileLayer(CreateTileSource("liberty")) { Name = "liberty" };
        _noBuildingsLayer = new TileLayer(CreateTileSource("liberty-nobuildings"))
        {
            Name = "liberty-nobuildings",
            Enabled = false,
        };
        _fiberLayer = new MemoryLayer("fiber-runs")
        {
            // Web parity: the fiber layer draws at z13 and closer.
            MaxVisible = ZoomToResolution(13),
            Style = null, // features carry their own styles; no layer default underneath
        };
        _deviceLayer = new MemoryLayer("devices") { Style = null };
        _liveLayer = new MemoryLayer("live-marker") { Style = null };

        SharedMap.Layers.Add(_libertyLayer);
        SharedMap.Layers.Add(_noBuildingsLayer);
        SharedMap.Layers.Add(_fiberLayer);
        SharedMap.Layers.Add(_deviceLayer);
        SharedMap.Layers.Add(_liveLayer);

        SharedMap.Navigator.ViewportChanged += OnViewportChanged;
        SharedMap.Tapped += OnMapTapped;

        _deviceUpdatedSubscription = realtime.OnDeviceUpdated(OnDeviceUpdated);
        _deviceDeletedSubscription = realtime.OnDeviceDeleted(OnDeviceDeleted);
        _metricsSubscription = realtime.OnMetricsUpdate(OnMetricsUpdate);
        // The server replays nothing across a connection gap: rebuild the device cache
        // from a fresh fleet read (deliberate deviation - the web waited for the next
        // pan to notice anything it missed).
        _reconnectedSubscription = realtime.OnReconnected(() => _ = ReloadAfterReconnectAsync());

        Categories = [.. DeviceCategories.All.Select(info => new CategoryToggle(info))];
        foreach (var toggle in Categories)
        {
            toggle.PropertyChanged += (_, _) => OnFiltersChanged();
        }

        CategoryGroups = [.. Categories
            .GroupBy(t => t.Info.Group)
            .Select(g => new CategoryGroup(g.Key, [.. g]))];

        Initialization = InitializeAsync();
    }

    /// <summary>Startup work (tile probe, preferences, fleet seed); awaited by tests.</summary>
    internal Task Initialization { get; }

    /// <summary>The Mapsui map the view hosts. Owned by this view model.</summary>
    public Mapsui.Map SharedMap { get; } = new();

    internal MemoryLayer DeviceLayer => _deviceLayer;

    internal MemoryLayer FiberLayer => _fiberLayer;

    internal MemoryLayer LiveLayer => _liveLayer;

    internal TileLayer LibertyLayer => _libertyLayer;

    internal TileLayer NoBuildingsLayer => _noBuildingsLayer;

    public IReadOnlyList<CategoryToggle> Categories { get; }

    public IReadOnlyList<CategoryGroup> CategoryGroups { get; }

    /// <summary>
    /// Required visible credit: ODbL for OSM data plus OpenMapTiles' CC-BY schema
    /// credit (planetiler prints this exact line at generation time).
    /// </summary>
    public static string Attribution => "© OpenMapTiles © OpenStreetMap contributors";

    /// <summary>The web map's zoom-level caption for the layers panel.</summary>
    public string ZoomLabel => CurrentZoom switch
    {
        >= 18 => "All devices",
        >= 16 => "Network equipment",
        >= 13 => "Core infrastructure",
        >= 10 => "ISP equipment",
        _ => "City view",
    };

    public string FloorModeLabel => FloorMode switch
    {
        FloorDisplayMode.Single => "One",
        FloorDisplayMode.Connection => "Manual",
        _ => "All",
    };

    public string? SelectedDeviceCategory => SelectedDevice is null
        ? null
        : DeviceCategories.Resolve(SelectedDevice.Category).DisplayName;

    public string? SelectedDeviceFloor => SelectedDevice switch
    {
        null => null,
        { FloorLabel: { Length: > 0 } label } => label,
        { Floor: { } floor } => FloorLabel(floor),
        _ => null,
    };

    internal static double ZoomToResolution(double zoom) => BaseResolution / Math.Pow(2, zoom);

    internal static double ResolutionToZoom(double resolution) => Math.Log2(BaseResolution / resolution);

    public void Dispose()
    {
        SharedMap.Navigator.ViewportChanged -= OnViewportChanged;
        SharedMap.Tapped -= OnMapTapped;
        _deviceUpdatedSubscription.Dispose();
        _deviceDeletedSubscription.Dispose();
        _metricsSubscription.Dispose();
        _reconnectedSubscription.Dispose();
        _lifetime.Cancel();
        _lifetime.Dispose();
        _viewportDebounce?.Dispose();
        _viewportLoad?.Dispose();
        _preferencesDebounce?.Dispose();
        _libertyLayer.Dispose();
        _noBuildingsLayer.Dispose();
        _fiberLayer.Dispose();
        _deviceLayer.Dispose();
        _liveLayer.Dispose();
        SharedMap.Dispose();
    }

    /// <summary>The floor selector shows once any device carries a floor.</summary>
    public bool HasFloors => FloorOptions.Count > 1;

    [RelayCommand]
    private void ClearSelection() => SelectedDevice = null;

    partial void OnSelectedFloorOptionChanged(FloorOption? value) => SelectedFloor = value?.Floor;

    partial void OnFloorOptionsChanged(IReadOnlyList<FloorOption> value)
    {
        OnPropertyChanged(nameof(HasFloors));
        // Keep the list selection in step when options rebuild (records compare by value).
        SelectedFloorOption = value.FirstOrDefault(o => o.Floor == SelectedFloor);
    }

    [RelayCommand]
    private void CycleFloorMode()
    {
        FloorMode = FloorMode switch
        {
            FloorDisplayMode.All => FloorDisplayMode.Single,
            FloorDisplayMode.Single => FloorDisplayMode.Connection,
            _ => FloorDisplayMode.All,
        };
    }

    /// <summary>The view's tap hit-test: selects the marker's device, if one was hit.</summary>
    internal void SelectDeviceById(string? deviceId)
    {
        SelectedDevice = deviceId is not null && _devices.TryGetValue(deviceId, out var device)
            ? device
            : null;
    }

    private async Task InitializeAsync()
    {
        var cancellationToken = _lifetime.Token;
        await ProbeTilesAsync(cancellationToken);
        await LoadPreferencesAsync(cancellationToken);
        await SeedDevicesAsync(cancellationToken);
        await LoadConfigureContextAsync(cancellationToken);
        if (!cancellationToken.IsCancellationRequested)
        {
            RebuildOverlays();
            RebuildLiveMarker();
        }
    }

    /// <summary>
    /// Web parity for entity deltas: the pushed device wins wholesale, and an unseen id
    /// merges in (an edit or placement of a device added since our seed).
    /// </summary>
    private void OnDeviceUpdated(DeviceUpdatedEvent received)
    {
        var mapDevice = ToMapDevice(received.Device);
        _devices[mapDevice.Id] = mapDevice;
        FloorOptions = BuildFloorOptions();
        RebuildOverlays();
        if (SelectedDevice?.Id == mapDevice.Id)
        {
            SelectedDevice = mapDevice; // the open panel shows the pushed state
        }
    }

    private void OnDeviceDeleted(DeviceDeletedEvent received)
    {
        if (!_devices.Remove(received.DeviceId))
        {
            return; // the echo of our own optimistic delete
        }

        if (SelectedDevice?.Id == received.DeviceId)
        {
            SelectedDevice = null;
        }

        FloorOptions = BuildFloorOptions();
        RebuildOverlays();
    }

    private void OnMetricsUpdate(MetricsUpdateEvent received)
    {
        _liveMetrics = received.Metrics;
        RebuildLiveMarker();
    }

    private async Task ReloadAfterReconnectAsync()
    {
        try
        {
            var fleet = await _session.Client.GetDevicesAsync(_session.Token, _lifetime.Token);
            _devices.Clear(); // only after a successful read - a failure keeps the old cache
            MergeDevices(fleet);
            await LoadViewportAsync();
            RebuildOverlays();
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or TaskCanceledException)
        {
            MapLog.DeviceSeedFailed(_logger, failure.Message);
        }
    }

    /// <summary>What placement needs before the FAB may show: scope, properties, the network.</summary>
    private async Task LoadConfigureContextAsync(CancellationToken cancellationToken)
    {
        try
        {
            var accessTask = _session.Client.GetAccessSummaryAsync(_session.Token, cancellationToken);
            var propertiesTask = _session.Client.GetPropertiesAsync(_session.Token, cancellationToken);
            var networksTask = _session.Client.GetNetworksAsync(_session.Token, cancellationToken);
            await Task.WhenAll(accessTask, propertiesTask, networksTask);

            _properties = await propertiesTask;
            _scope = ConfigureScope.Build(await accessTask, _properties);
            var networks = await networksTask;
            _networkId = networks.Count > 0 ? networks[0].Id : null;
            CanConfigure = _scope.CanConfigureAny && _networkId is not null
                && _scope.ConfigurableProperties(_properties).Count > 0;
            OnPropertyChanged(nameof(SelectedDeviceEditable));
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or TaskCanceledException)
        {
            MapLog.ConfigureContextFailed(_logger, failure.Message);
        }
    }

    private async Task ProbeTilesAsync(CancellationToken cancellationToken)
    {
        try
        {
            TilesUnavailable = !await _session.Client.ProbeTilesAsync(cancellationToken);
        }
        catch (Exception failure) when (failure is HttpRequestException or TaskCanceledException)
        {
            TilesUnavailable = true;
        }
    }

    private async Task LoadPreferencesAsync(CancellationToken cancellationToken)
    {
        MapPreferences? preferences = null;
        try
        {
            var stored = await _session.Client.GetPreferencesAsync(_session.Token, cancellationToken);
            preferences = stored?.Deserialize<MapPreferences>(Json);
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or TaskCanceledException or JsonException)
        {
            MapLog.PreferencesLoadFailed(_logger, failure.Message);
        }

        _applyingPreferences = true;
        try
        {
            ApplyPreferences(preferences);
        }
        finally
        {
            _applyingPreferences = false;
        }
    }

    private void ApplyPreferences(MapPreferences? preferences)
    {
        if (preferences?.BuildingsVisible is { } buildings)
        {
            BuildingsVisible = buildings;
        }

        if (preferences?.LayerToggles is { } toggles)
        {
            foreach (var toggle in Categories)
            {
                if (toggles.TryGetValue(toggle.Info.Category, out var enabled))
                {
                    toggle.IsEnabled = enabled;
                }
            }
        }

        SelectedFloor = preferences?.SelectedFloor;
        FloorMode = preferences?.FloorDisplayMode switch
        {
            "single" => FloorDisplayMode.Single,
            "connection" => FloorDisplayMode.Connection,
            _ => FloorDisplayMode.All,
        };

        // Initial camera, web-parity order: stored center at its zoom, else the
        // user's home at z13, else the world at z2.
        if (preferences?.MapCenter is [var lng, var lat])
        {
            NavigateTo(lng, lat, preferences.MapZoom ?? 13);
        }
        else if (_user is { HomeLatitude: not null and not 0, HomeLongitude: not null and not 0 })
        {
            NavigateTo(_user.HomeLongitude.Value, _user.HomeLatitude.Value, 13);
        }
        else
        {
            NavigateTo(0, 0, 2);
        }
    }

    private void NavigateTo(double lng, double lat, double zoom)
    {
        var (x, y) = SphericalMercator.FromLonLat(lng, lat);
        SharedMap.Navigator.CenterOnAndZoomTo(new MPoint(x, y), ZoomToResolution(zoom));
        CurrentZoom = zoom;
    }

    private async Task SeedDevicesAsync(CancellationToken cancellationToken)
    {
        // Web parity: the device store seeded the whole fleet up front, which is also
        // what lets fiber lines resolve endpoints that sit outside the viewport.
        try
        {
            MergeDevices(await _session.Client.GetDevicesAsync(_session.Token, cancellationToken));
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or TaskCanceledException)
        {
            MapLog.DeviceSeedFailed(_logger, failure.Message);
            DataError = "Could not load devices from the appliance.";
        }
    }

    private void OnViewportChanged(object? sender, EventArgs e)
    {
        var viewport = SharedMap.Navigator.Viewport;
        if (!viewport.HasSize())
        {
            return;
        }

        var zoom = ResolutionToZoom(viewport.Resolution);
        if (Math.Abs(zoom - CurrentZoom) > 0.01)
        {
            CurrentZoom = zoom; // OnCurrentZoomChanged rebuilds the zoom-gated overlays
        }

        ScheduleViewportLoad();
        if (!_applyingPreferences)
        {
            SchedulePreferencesSave();
        }
    }

    private void ScheduleViewportLoad()
    {
        _viewportDebounce?.Cancel();
        _viewportDebounce?.Dispose();
        _viewportDebounce = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
        _ = DebounceThenLoadAsync(_viewportDebounce.Token);
    }

    private async Task DebounceThenLoadAsync(CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(ViewportDebounce, _time, cancellationToken);
        }
        catch (TaskCanceledException)
        {
            return; // superseded by a newer viewport change
        }

        await LoadViewportAsync();
    }

    /// <summary>The bbox load pair; internal so tests can await a settled load.</summary>
    internal async Task LoadViewportAsync()
    {
        var viewport = SharedMap.Navigator.Viewport;
        if (!viewport.HasSize())
        {
            return;
        }

        var extent = viewport.ToExtent();
        var (west, south) = SphericalMercator.ToLonLat(extent.MinX, extent.MinY);
        var (east, north) = SphericalMercator.ToLonLat(extent.MaxX, extent.MaxY);
        var bbox = new MapBbox(west, south, east, north);

        // A newer viewport cancels the in-flight pair, like the web's AbortController.
        if (_viewportLoad is { } previous)
        {
            await previous.CancelAsync();
        }

        _viewportLoad?.Dispose();
        _viewportLoad = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
        var cancellationToken = _viewportLoad.Token;

        try
        {
            var devicesTask = _session.Client.GetMapDevicesAsync(
                _session.Token, bbox, SelectedFloor, cancellationToken);
            var fiberTask = _session.Client.GetMapFiberRunsAsync(_session.Token, bbox, cancellationToken);
            await Task.WhenAll(devicesTask, fiberTask);

            MergeDevices(await devicesTask);
            _fiberRuns = await fiberTask;
            DataError = null;
            RebuildOverlays();
        }
        catch (Exception failure) when (failure is TaskCanceledException or OperationCanceledException)
        {
            // Superseded or shutting down - the newer load owns the map now.
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            MapLog.ViewportLoadFailed(_logger, failure.Message);
            DataError = "Could not load map data from the appliance.";
        }
    }

    private void MergeDevices(IReadOnlyList<MapDevice> incoming)
    {
        foreach (var device in incoming)
        {
            _devices[device.Id] = device;
        }

        FloorOptions = BuildFloorOptions();
    }

    private IReadOnlyList<FloorOption> BuildFloorOptions()
    {
        var floors = _devices.Values
            .Where(d => d.Floor is not null)
            .Select(d => d.Floor!.Value)
            .Distinct()
            .Order()
            .Select(f => new FloorOption(f, FloorLabel(f)));

        return [new FloorOption(null, "All floors"), .. floors];
    }

    /// <summary>Web parity: 0 = Ground, positive = Floor n, negative = B n.</summary>
    internal static string FloorLabel(int floor) => floor switch
    {
        0 => "Ground",
        > 0 => $"Floor {floor}",
        _ => $"B{-floor}",
    };

    private void OnFiltersChanged()
    {
        RebuildOverlays();
        SchedulePreferencesSave();
    }

    partial void OnBuildingsVisibleChanged(bool value)
    {
        _libertyLayer.Enabled = value;
        _noBuildingsLayer.Enabled = !value;
        SharedMap.RefreshGraphics();
        if (!_applyingPreferences)
        {
            SchedulePreferencesSave();
        }
    }

    partial void OnSelectedFloorChanged(int? value)
    {
        OnFiltersChanged();
        // The floor filter is a query parameter too - reload the viewport with it.
        ScheduleViewportLoad();
    }

    partial void OnFloorModeChanged(FloorDisplayMode value)
    {
        OnPropertyChanged(nameof(FloorModeLabel));
        OnFiltersChanged();
    }

    partial void OnCurrentZoomChanged(double value)
    {
        OnPropertyChanged(nameof(ZoomLabel));
        RebuildOverlays(); // the marker zoom gates read CurrentZoom
    }

    partial void OnSelectedDeviceChanged(MapDevice? value)
    {
        OnPropertyChanged(nameof(SelectedDeviceCategory));
        OnPropertyChanged(nameof(SelectedDeviceFloor));
        OnPropertyChanged(nameof(SelectedDeviceEditable));
        ConfirmingSelectedDelete = false;
        RebuildDeviceFeatures();
    }

    /// <summary>Projects the caches onto the overlay layers with all gates applied.</summary>
    private void RebuildOverlays()
    {
        RebuildDeviceFeatures();
        RebuildFiberFeatures();
    }

    private void RebuildDeviceFeatures()
    {
        var features = new List<IFeature>();
        foreach (var device in VisibleDevices())
        {
            var info = DeviceCategories.Resolve(device.Category);
            var (x, y) = SphericalMercator.FromLonLat(device.Longitude!.Value, device.Latitude!.Value);
            var selected = device.Id == SelectedDevice?.Id;
            var dimmed = SelectedFloor is { } floor
                && FloorMode != FloorDisplayMode.Single
                && device.Floor != floor;

            var feature = new PointFeature(x, y);
            feature["deviceId"] = device.Id;
            feature.Styles.Add(new SymbolStyle
            {
                // Web parity: 36 px circle, 42 px selected, white outline, category fill.
                SymbolScale = selected ? 42d / 32d : 36d / 32d,
                Fill = new Brush(HexColor(info.Color)),
                Outline = new Pen(Color.White, selected ? 3 : 2),
                Opacity = dimmed ? 0.3f : 1f,
            });
            feature.Styles.Add(new LabelStyle
            {
                Text = info.Abbreviation,
                ForeColor = Color.White,
                BackColor = null,
                Font = new Font { Bold = true, Size = 11 },
                HorizontalAlignment = LabelStyle.HorizontalAlignmentEnum.Center,
                VerticalAlignment = LabelStyle.VerticalAlignmentEnum.Center,
                Opacity = dimmed ? 0.3f : 1f,
            });
            features.Add(feature);
        }

        _deviceLayer.Features = features;
        _deviceLayer.DataHasChanged();
    }

    /// <summary>The web map's five marker gates: coords, zoom, category toggle, floor.</summary>
    private IEnumerable<MapDevice> VisibleDevices()
    {
        var toggles = Categories.ToDictionary(t => t.Info.Category, t => t.IsEnabled, StringComparer.Ordinal);
        foreach (var device in _devices.Values)
        {
            if (device.Latitude is null || device.Longitude is null)
            {
                continue;
            }

            var info = DeviceCategories.Resolve(device.Category);
            if (CurrentZoom < info.MinZoom)
            {
                continue;
            }

            if (toggles.TryGetValue(info.Category, out var enabled) && !enabled)
            {
                continue;
            }

            if (SelectedFloor is { } floor
                && FloorMode == FloorDisplayMode.Single
                && device.Floor != floor)
            {
                continue;
            }

            yield return device;
        }
    }

    private void RebuildFiberFeatures()
    {
        var features = new List<IFeature>();
        foreach (var run in _fiberRuns)
        {
            // The line is derived: join both endpoint ids to device coordinates and
            // drop runs whose endpoints are unknown or unplaced - exactly like the web.
            if (!_devices.TryGetValue(run.StartDeviceId, out var start)
                || !_devices.TryGetValue(run.EndDeviceId, out var end)
                || start.Latitude is null || start.Longitude is null
                || end.Latitude is null || end.Longitude is null)
            {
                continue;
            }

            var (x1, y1) = SphericalMercator.FromLonLat(start.Longitude.Value, start.Latitude.Value);
            var (x2, y2) = SphericalMercator.FromLonLat(end.Longitude.Value, end.Latitude.Value);
            var feature = new GeometryFeature(
                new LineString([new Coordinate(x1, y1), new Coordinate(x2, y2)]));
            feature.Styles.Add(new VectorStyle
            {
                // Web parity: #f97316, width 2, dashed, round caps, 0.8 opacity.
                Line = new Pen(HexColor("#f97316"), 2)
                {
                    PenStyle = PenStyle.Dash,
                    PenStrokeCap = PenStrokeCap.Round,
                    StrokeJoin = StrokeJoin.Round,
                },
                Opacity = 0.8f,
            });
            features.Add(feature);
        }

        _fiberLayer.Features = features;
        _fiberLayer.DataHasChanged();
    }

    /// <summary>
    /// The web map's live pulse marker, on this client's terms: the position is the
    /// user's saved geocoded location - a desktop has no browser geolocation, and the
    /// product's own "where I am" is what the map already centers on - and the badge
    /// carries the same live stats. The web's 2s CSS pulse ring renders as a static
    /// halo here: animating it would redraw the raster overlay at frame rate for
    /// decoration (recorded deviation).
    /// </summary>
    private void RebuildLiveMarker()
    {
        if (_user is not { HomeLatitude: not null and not 0, HomeLongitude: not null and not 0 })
        {
            _liveLayer.Features = [];
            _liveLayer.DataHasChanged();
            return;
        }

        var (x, y) = SphericalMercator.FromLonLat(_user.HomeLongitude.Value, _user.HomeLatitude.Value);
        var feature = new PointFeature(x, y);

        // Web parity: 44 px halo at rgba(37,99,235,0.3), 16 px #2563eb dot, 3 px white border.
        feature.Styles.Add(new SymbolStyle
        {
            SymbolScale = 44d / 32d,
            Fill = new Brush(Color.FromArgb(77, 37, 99, 235)),
            Outline = null,
        });
        feature.Styles.Add(new SymbolStyle
        {
            SymbolScale = 16d / 32d,
            Fill = new Brush(HexColor("#2563eb")),
            Outline = new Pen(Color.White, 3),
        });

        if (FormatLiveStats(_liveMetrics) is { } stats)
        {
            // Web parity: the dark stats badge under the dot.
            feature.Styles.Add(new LabelStyle
            {
                Text = stats,
                ForeColor = Color.White,
                BackColor = new Brush(Color.FromArgb(217, 15, 23, 42)),
                Font = new Font { Size = 10 },
                HorizontalAlignment = LabelStyle.HorizontalAlignmentEnum.Center,
                VerticalAlignment = LabelStyle.VerticalAlignmentEnum.Top,
                Offset = new Offset(0, 26),
            });
        }

        _liveLayer.Features = [feature];
        _liveLayer.DataHasChanged();
    }

    /// <summary>Web parity with LiveMarker's formatStats: absent fields drop out.</summary>
    internal static string? FormatLiveStats(ClientMetrics? metrics)
    {
        if (metrics is null)
        {
            return null;
        }

        var parts = new List<string>(3);
        if (metrics.Latency is { } latency && double.IsFinite(latency))
        {
            parts.Add(string.Create(CultureInfo.InvariantCulture, $"{Math.Round(latency)} ms"));
        }

        if (metrics.BandwidthDown is { } down && double.IsFinite(down))
        {
            parts.Add(string.Create(CultureInfo.InvariantCulture, $"↓{down:0}"));
        }

        if (metrics.BandwidthUp is { } up && double.IsFinite(up))
        {
            parts.Add(string.Create(CultureInfo.InvariantCulture, $"↑{up:0}"));
        }

        return parts.Count > 0 ? string.Join(" · ", parts) : null;
    }

    private void OnMapTapped(object? sender, MapEventArgs e)
    {
        var info = e.GetMapInfo([_deviceLayer]);
        if (IsPlacing)
        {
            if (info.WorldPosition is { } world)
            {
                var (lng, lat) = SphericalMercator.ToLonLat(world.X, world.Y);
                CompletePlacement(lat, lng);
            }

            return;
        }

        SelectDeviceById(info.Feature?["deviceId"] as string);
    }

    /// <summary>Whether the selected device may be edited here (F3 verdict for its property).</summary>
    public bool SelectedDeviceEditable =>
        SelectedDevice is { PropertyId: { } propertyId }
        && _scope?.CanConfigureProperty(propertyId) is true;

    [RelayCommand]
    private void StartPlacement()
    {
        if (!CanConfigure)
        {
            return;
        }

        SelectedDevice = null;
        IsPlacing = true;
    }

    [RelayCommand]
    private void CancelPlacement()
    {
        IsPlacing = false;
        if (_relocatingForm is { } form)
        {
            // The aborted relocation reopens the edit form unchanged.
            _relocatingForm = null;
            DeviceForm = form;
        }
    }

    /// <summary>The placement tap's landing point; internal so tests can drive it directly.</summary>
    internal void CompletePlacement(double latitude, double longitude)
    {
        IsPlacing = false;
        if (_relocatingForm is { } form)
        {
            _relocatingForm = null;
            form.PlacedLatitude = latitude;
            form.PlacedLongitude = longitude;
            DeviceForm = form;
            return;
        }

        if (_scope is null || _networkId is null)
        {
            return;
        }

        var options = PropertyOption.Flatten(_scope.ConfigurableProperties(_properties));
        var created = new DeviceFormViewModel(
            original: null,
            options,
            SubmitCreateAsync,
            close: () => DeviceForm = null,
            suggestName: (propertyId, category, cancellationToken) =>
                _session.Client.GetDeviceNameSuggestionAsync(_session.Token, propertyId, category, cancellationToken))
        {
            PlacedLatitude = latitude,
            PlacedLongitude = longitude,
        };
        DeviceForm = created;
    }

    /// <summary>Opens the edit form for the selected marker, off a fresh single-device read.</summary>
    [RelayCommand]
    private async Task EditSelectedAsync()
    {
        if (SelectedDevice is not { } selected || !SelectedDeviceEditable)
        {
            return;
        }

        try
        {
            var device = await _session.Client.GetDeviceAsync(_session.Token, selected.Id, _lifetime.Token);
            DeviceFormViewModel? form = null;
            form = new DeviceFormViewModel(
                device,
                PropertyOption.Flatten(_properties),
                SubmitEditAsync,
                close: () => DeviceForm = null,
                suggestName: null,
                relocate: () =>
                {
                    _relocatingForm = form;
                    DeviceForm = null;
                    IsPlacing = true;
                });
            DeviceForm = form;
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            OperationError = $"Loading the device failed: {failure.Message}";
        }
    }

    /// <summary>First press arms ("Confirm?"), second press deletes - mirrors the list rows.</summary>
    [RelayCommand]
    private async Task DeleteSelectedAsync()
    {
        if (SelectedDevice is not { } selected || !SelectedDeviceEditable)
        {
            return;
        }

        if (!ConfirmingSelectedDelete)
        {
            ConfirmingSelectedDelete = true;
            return;
        }

        ConfirmingSelectedDelete = false;
        _devices.Remove(selected.Id);
        SelectedDevice = null;
        RebuildOverlays();
        try
        {
            await _session.Client.DeleteDeviceAsync(_session.Token, selected.Id, _lifetime.Token);
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            _devices[selected.Id] = selected;
            RebuildOverlays();
            OperationError = $"Deleting \"{selected.Name}\" failed: {failure.Message}";
        }
    }

    [RelayCommand]
    private void DismissOperationError() => OperationError = null;

    private async Task<bool> SubmitCreateAsync(DeviceFormViewModel form, CancellationToken cancellationToken)
    {
        try
        {
            var created = await _session.Client.CreateDeviceAsync(
                _session.Token, form.BuildCreate(_networkId!), cancellationToken);
            var mapDevice = ToMapDevice(created);
            _devices[mapDevice.Id] = mapDevice;
            FloorOptions = BuildFloorOptions();
            RebuildOverlays();
            SelectedDevice = mapDevice;

            // Web parity: fly to the new marker at its category's reveal zoom.
            if (created is { Latitude: { } lat, Longitude: { } lng })
            {
                var minZoom = DeviceCategories.Resolve(created.Category).MinZoom;
                NavigateTo(lng, lat, Math.Max(CurrentZoom, minZoom));
            }

            return true;
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            form.SubmitError = failure.Message;
            return false;
        }
    }

    private async Task<bool> SubmitEditAsync(DeviceFormViewModel form, CancellationToken cancellationToken)
    {
        var changes = form.BuildChanges();
        if (changes.Count == 0)
        {
            return true;
        }

        var original = form.Original!;
        try
        {
            var updated = await _session.Client.UpdateDeviceAsync(
                _session.Token, original.Id, original.Version, changes, cancellationToken);
            var mapDevice = ToMapDevice(updated);
            _devices[mapDevice.Id] = mapDevice;
            FloorOptions = BuildFloorOptions();
            RebuildOverlays();
            if (SelectedDevice?.Id == mapDevice.Id)
            {
                SelectedDevice = mapDevice;
            }

            return true;
        }
        catch (ApplianceApiException failure) when (failure.Code == "SYNC_001")
        {
            form.SubmitError = "Someone else edited this device. Close the form and reopen it to retry.";
            return false;
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            form.SubmitError = failure.Message;
            return false;
        }
    }

    private static MapDevice ToMapDevice(BimDevice device) => new(
        device.Id,
        device.Name,
        device.Category,
        device.Latitude,
        device.Longitude,
        device.Floor,
        device.FloorLabel,
        device.IpAddress,
        device.PropertyId);

    private void SchedulePreferencesSave()
    {
        _preferencesDebounce?.Cancel();
        _preferencesDebounce?.Dispose();
        _preferencesDebounce = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
        _ = DebounceThenSavePreferencesAsync(_preferencesDebounce.Token);
    }

    private async Task DebounceThenSavePreferencesAsync(CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(PreferencesDebounce, _time, cancellationToken);
        }
        catch (TaskCanceledException)
        {
            return;
        }

        var preferences = BuildPreferences();
        try
        {
            await _session.Client.PutPreferencesAsync(
                _session.Token, JsonSerializer.SerializeToElement(preferences, Json), cancellationToken);
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or TaskCanceledException)
        {
            MapLog.PreferencesSaveFailed(_logger, failure.Message);
        }
    }

    internal MapPreferences BuildPreferences()
    {
        var viewport = SharedMap.Navigator.Viewport;
        double[]? center = null;
        if (viewport.HasSize())
        {
            var (lng, lat) = SphericalMercator.ToLonLat(viewport.CenterX, viewport.CenterY);
            center = [lng, lat];
        }

        return new MapPreferences(
            BuildingsVisible,
            Categories.ToDictionary(t => t.Info.Category, t => t.IsEnabled, StringComparer.Ordinal),
            center,
            center is null ? null : Math.Round(CurrentZoom, 2),
            SelectedFloor,
            FloorMode switch
            {
                FloorDisplayMode.Single => "single",
                FloorDisplayMode.Connection => "connection",
                _ => "all",
            });
    }

    private BruTile.Web.HttpTileSource CreateTileSource(string style)
    {
        // The {z}/{x}/{y} placeholders must stay OUT of System.Uri: AbsoluteUri
        // percent-encodes braces, BruTile's replacement then never matches, and
        // tileserver-gl parses the literal "{z}" as 0 - every request returns the
        // z0 world tile (found by the live E2E's pixel check). Only the base is
        // resolved as a Uri (it handles an ".../api"-shaped server URL); the
        // template is appended as a plain string.
        var styleRoot = new Uri(_session.Client.BaseUrl, $"tiles/styles/{style}/");
        return new BruTile.Web.HttpTileSource(
            new BruTile.Predefined.GlobalSphericalMercator(),
            styleRoot.AbsoluteUri + "{z}/{x}/{y}.png",
            name: style);
    }

    private static Color HexColor(string hex) => Color.FromArgb(
        255,
        Convert.ToInt32(hex.Substring(1, 2), 16),
        Convert.ToInt32(hex.Substring(3, 2), 16),
        Convert.ToInt32(hex.Substring(5, 2), 16));
}

/// <summary>Source-generated log messages for the map surface (CA1848).</summary>
internal static partial class MapLog
{
    [LoggerMessage(Level = LogLevel.Warning,
        Message = "Map viewport load failed: {Reason}")]
    public static partial void ViewportLoadFailed(ILogger logger, string reason);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "Loading map preferences failed; using defaults: {Reason}")]
    public static partial void PreferencesLoadFailed(ILogger logger, string reason);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "Saving map preferences failed: {Reason}")]
    public static partial void PreferencesSaveFailed(ILogger logger, string reason);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "Seeding the device cache failed: {Reason}")]
    public static partial void DeviceSeedFailed(ILogger logger, string reason);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "Loading the placement context failed; device placement stays hidden: {Reason}")]
    public static partial void ConfigureContextFailed(ILogger logger, string reason);
}
