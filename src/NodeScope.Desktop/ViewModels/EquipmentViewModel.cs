using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Extensions.Logging;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Map;

namespace NodeScope.Desktop.ViewModels;

/// <summary>One device row in the equipment list, with its two-step delete state.</summary>
[INotifyPropertyChanged]
internal sealed partial class DeviceRow(BimDevice device, bool canConfigure)
{
    [ObservableProperty]
    private bool _confirmingDelete;

    public BimDevice Device { get; } = device;

    /// <summary>Whether edit/delete are offered - the F3 scope verdict for this row.</summary>
    public bool CanConfigure { get; } = canConfigure;

    public string CategoryLine
    {
        get
        {
            var category = DeviceCategories.Resolve(Device.Category).DisplayName;
            if (Device.Floor is not { } floor)
            {
                return category;
            }

            var floorLabel = Device.FloorLabel
                ?? (floor == 0 ? "Ground" : string.Create(CultureInfo.InvariantCulture, $"Floor {floor}"));
            return $"{category} · {floorLabel}";
        }
    }

    public string? CoordinateLine =>
        Device is { Latitude: { } latitude, Longitude: { } longitude }
            ? string.Create(CultureInfo.InvariantCulture, $"{latitude:F4}, {longitude:F4}")
            : null;
}

/// <summary>One category-group filter chip (web parity: All / ISP / Core / Network / End-User / Custom).</summary>
[INotifyPropertyChanged]
internal sealed partial class CategoryFilterChip(string label, IReadOnlyList<string> categories)
{
    [ObservableProperty]
    private bool _isActive;

    public string Label { get; } = label;

    /// <summary>Empty means "All" - the chip that clears the filter.</summary>
    public IReadOnlyList<string> Categories { get; } = categories;
}

/// <summary>One floor filter chip; a null floor is "All floors".</summary>
[INotifyPropertyChanged]
internal sealed partial class FloorFilterChip(int? floor, string label)
{
    [ObservableProperty]
    private bool _isActive;

    public int? Floor { get; } = floor;

    public string Label { get; } = label;
}

/// <summary>
/// The equipment tab: the fleet as an editable list. A port of the web equipment screen
/// plus what that screen was missing against this API - the property picker (create
/// requires a chartered property) and honest role/scope gating.
/// </summary>
[INotifyPropertyChanged]
internal sealed partial class EquipmentViewModel : IDisposable
{
    private static readonly (string Label, string[] Categories)[] CategoryGroups =
    [
        ("All", []),
        ("ISP", ["RAD", "ONT", "DSLAM"]),
        ("Core", ["ROUTER", "MODEM", "FIBER_MEDIA_CONVERTER", "FIREWALL"]),
        ("Network", ["SWITCH", "ACCESS_POINT", "WIFI_EXTENDER", "WIRELESS_BRIDGE", "SERVER_RACK", "PATCH_PANEL", "UPS"]),
        ("End-User", ["COMPUTER", "PHONE", "TABLET", "PRINTER", "IOT_DEVICE"]),
        ("Custom", ["CUSTOM"]),
    ];

    private readonly ApplianceSession _session;
    private readonly ILogger _logger;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly List<BimDevice> _devices = [];
    private readonly HashSet<string> _categoryFilter = new(StringComparer.Ordinal);

    private ConfigureScope? _scope;
    private IReadOnlyList<PropertySummary> _properties = [];
    private string? _networkId;
    private int? _floorFilter;

    [ObservableProperty]
    private bool _isLoading = true;

    [ObservableProperty]
    private string? _loadError;

    [ObservableProperty]
    private string? _operationError;

    [ObservableProperty]
    private string _searchText = "";

    [ObservableProperty]
    private IReadOnlyList<DeviceRow> _rows = [];

    [ObservableProperty]
    private IReadOnlyList<FloorFilterChip> _floorChips = [];

    [ObservableProperty]
    private DeviceFormViewModel? _form;

    [ObservableProperty]
    private bool _canAdd;

    [ObservableProperty]
    private string? _loadedAtLabel;

    public EquipmentViewModel(ApplianceSession session, ILogger logger, TimeProvider? time = null)
    {
        _session = session;
        _logger = logger;
        Time = time ?? TimeProvider.System;
        CategoryChips = [.. CategoryGroups.Select(group => new CategoryFilterChip(group.Label, group.Categories))];
        CategoryChips[0].IsActive = true;
        Initialization = LoadAsync();
    }

    /// <summary>The initial load; awaited by tests.</summary>
    internal Task Initialization { get; }

    /// <summary>Injectable clock so the "updated at" label is testable.</summary>
    public TimeProvider Time { get; }

    public IReadOnlyList<CategoryFilterChip> CategoryChips { get; }

    public string EmptyMessage =>
        _devices.Count == 0 ? "No devices yet. Add your first device." : "No devices match your filters.";

    public bool HasFloorChips => FloorChips.Count > 0;

    partial void OnFloorChipsChanged(IReadOnlyList<FloorFilterChip> value) =>
        OnPropertyChanged(nameof(HasFloorChips));

    public bool IsListEmpty => Rows.Count == 0 && !IsLoading && LoadError is null;

    /// <summary>The fleet as currently loaded; the map placement flow reuses it.</summary>
    public IReadOnlyList<BimDevice> Devices => _devices;

    public void Dispose()
    {
        _lifetime.Cancel();
        _lifetime.Dispose();
    }

    [RelayCommand]
    public async Task LoadAsync()
    {
        IsLoading = true;
        LoadError = null;
        try
        {
            var token = _session.Token;
            var devicesTask = _session.Client.GetDeviceInventoryAsync(token, _lifetime.Token);
            var accessTask = _session.Client.GetAccessSummaryAsync(token, _lifetime.Token);
            var propertiesTask = _session.Client.GetPropertiesAsync(token, _lifetime.Token);
            var networksTask = _session.Client.GetNetworksAsync(token, _lifetime.Token);
            await Task.WhenAll(devicesTask, accessTask, propertiesTask, networksTask);

            _devices.Clear();
            _devices.AddRange((await devicesTask).Items);
            _properties = await propertiesTask;
            _scope = ConfigureScope.Build(await accessTask, _properties);
            var networks = await networksTask;
            _networkId = networks.Count > 0 ? networks[0].Id : null;
            CanAdd = _scope.CanConfigureAny && _networkId is not null
                && _scope.ConfigurableProperties(_properties).Count > 0;
            LoadedAtLabel = string.Create(
                CultureInfo.InvariantCulture, $"Updated {Time.GetLocalNow():HH:mm}");
            RebuildRows();
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            LoadError = failure.Message;
            EquipmentLog.LoadFailed(_logger, failure);
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private void ToggleCategoryChip(CategoryFilterChip chip)
    {
        if (chip.Categories.Count == 0)
        {
            _categoryFilter.Clear();
        }
        else if (chip.Categories.Any(_categoryFilter.Contains))
        {
            _categoryFilter.ExceptWith(chip.Categories);
        }
        else
        {
            _categoryFilter.UnionWith(chip.Categories);
        }

        foreach (var candidate in CategoryChips)
        {
            candidate.IsActive = candidate.Categories.Count == 0
                ? _categoryFilter.Count == 0
                : candidate.Categories.Any(_categoryFilter.Contains);
        }

        RebuildRows();
    }

    [RelayCommand]
    private void SelectFloorChip(FloorFilterChip chip)
    {
        _floorFilter = chip.Floor == _floorFilter ? null : chip.Floor;
        RebuildRows();
    }

    [RelayCommand]
    private void BeginAdd()
    {
        if (_scope is null || _networkId is null)
        {
            return;
        }

        var options = PropertyOption.Flatten(_scope.ConfigurableProperties(_properties));
        Form = new DeviceFormViewModel(
            original: null,
            options,
            SubmitCreateAsync,
            close: () => Form = null,
            suggestName: (propertyId, category, cancellationToken) =>
                _session.Client.GetDeviceNameSuggestionAsync(_session.Token, propertyId, category, cancellationToken));
    }

    [RelayCommand]
    private void BeginEdit(DeviceRow row)
    {
        if (!row.CanConfigure)
        {
            return;
        }

        Form = new DeviceFormViewModel(
            row.Device,
            PropertyOption.Flatten(_properties),
            SubmitEditAsync,
            close: () => Form = null);
    }

    /// <summary>First press arms the row ("Confirm?"), second press deletes - no dialog.</summary>
    [RelayCommand]
    private async Task DeleteAsync(DeviceRow row)
    {
        if (!row.ConfirmingDelete)
        {
            foreach (var candidate in Rows)
            {
                candidate.ConfirmingDelete = false;
            }

            row.ConfirmingDelete = true;
            return;
        }

        var index = _devices.FindIndex(device => device.Id == row.Device.Id);
        if (index < 0)
        {
            return;
        }

        var removed = _devices[index];
        _devices.RemoveAt(index);
        RebuildRows();
        try
        {
            await _session.Client.DeleteDeviceAsync(_session.Token, removed.Id, _lifetime.Token);
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            _devices.Insert(Math.Min(index, _devices.Count), removed);
            RebuildRows();
            OperationError = $"Deleting \"{removed.Name}\" failed: {failure.Message}";
            EquipmentLog.MutationFailed(_logger, "delete", failure);
        }
    }

    [RelayCommand]
    private void DismissOperationError() => OperationError = null;

    partial void OnSearchTextChanged(string value) => RebuildRows();

    private async Task<bool> SubmitCreateAsync(DeviceFormViewModel form, CancellationToken cancellationToken)
    {
        try
        {
            var created = await _session.Client.CreateDeviceAsync(
                _session.Token, form.BuildCreate(_networkId!), cancellationToken);
            _devices.Insert(0, created);
            RebuildRows();
            return true;
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            form.SubmitError = failure.Message;
            EquipmentLog.MutationFailed(_logger, "create", failure);
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
            var index = _devices.FindIndex(device => device.Id == updated.Id);
            if (index >= 0)
            {
                _devices[index] = updated;
            }

            RebuildRows();
            return true;
        }
        catch (ApplianceApiException failure) when (failure.Code == "SYNC_001")
        {
            form.SubmitError = "Someone else edited this device. The list has been refreshed - reopen it to retry.";
            await LoadAsync();
            return false;
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            form.SubmitError = failure.Message;
            EquipmentLog.MutationFailed(_logger, "update", failure);
            return false;
        }
    }

    private void RebuildRows()
    {
        var search = SearchText.Trim();
        Rows =
        [
            .. _devices
                .Where(device =>
                    (search.Length == 0
                        || device.Name.Contains(search, StringComparison.OrdinalIgnoreCase))
                    && (_categoryFilter.Count == 0 || _categoryFilter.Contains(device.Category))
                    && (_floorFilter is null || device.Floor == _floorFilter))
                .Select(device => new DeviceRow(
                    device, _scope?.CanConfigureProperty(device.PropertyId) ?? false)),
        ];

        var floors = _devices
            .Where(device => device.Floor is not null)
            .Select(device => device.Floor!.Value)
            .Distinct()
            .Order()
            .ToList();
        var chips = new List<FloorFilterChip>();
        if (floors.Count > 0)
        {
            chips.Add(new FloorFilterChip(null, "All floors"));
            chips.AddRange(floors.Select(floor => new FloorFilterChip(
                floor,
                floor == 0 ? "Ground" : string.Create(CultureInfo.InvariantCulture, $"Floor {floor}"))));
        }

        foreach (var chip in chips)
        {
            chip.IsActive = chip.Floor == _floorFilter;
        }

        FloorChips = chips;
        OnPropertyChanged(nameof(IsListEmpty));
        OnPropertyChanged(nameof(EmptyMessage));
    }
}

/// <summary>CA1873-shaped log methods (no invocations inside log-call argument lists).</summary>
internal static partial class EquipmentLog
{
    [LoggerMessage(Level = LogLevel.Warning, Message = "Equipment load failed")]
    public static partial void LoadFailed(ILogger logger, Exception exception);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Equipment {Operation} failed")]
    public static partial void MutationFailed(ILogger logger, string operation, Exception exception);
}
