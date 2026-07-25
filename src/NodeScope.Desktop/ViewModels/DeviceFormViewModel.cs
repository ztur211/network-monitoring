using System.Globalization;
using System.Net;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Map;

namespace NodeScope.Desktop.ViewModels;

/// <summary>One selectable property in the device form's picker, indented by tree depth.</summary>
internal sealed record PropertyOption(string Id, string Label)
{
    /// <summary>
    /// Flattens the property tree depth-first so the picker reads as an indented outline.
    /// Order inside a level is the API's (name-sorted server-side).
    /// </summary>
    public static IReadOnlyList<PropertyOption> Flatten(IReadOnlyList<PropertySummary> properties)
    {
        var byParent = properties
            .GroupBy(property => property.ParentId ?? "")
            .ToDictionary(group => group.Key, group => group.ToList(), StringComparer.Ordinal);
        var options = new List<PropertyOption>();

        void Walk(string parentKey, int depth)
        {
            if (!byParent.TryGetValue(parentKey, out var children))
            {
                return;
            }

            foreach (var property in children)
            {
                var indent = string.Concat(Enumerable.Repeat("    ", depth));
                options.Add(new PropertyOption(property.Id, $"{indent}{property.Name} ({property.Type})"));
                Walk(property.Id, depth + 1);
            }
        }

        Walk("", 0);
        return options;
    }
}

/// <summary>
/// The device create/edit form, shared by the equipment tab and the map's placement
/// flow. Validation mirrors the server's create rules so the common failures never
/// leave the client; the owner supplies the actual submit so list bookkeeping stays
/// with the list.
/// </summary>
[INotifyPropertyChanged]
internal sealed partial class DeviceFormViewModel
{
    private readonly Func<DeviceFormViewModel, CancellationToken, Task<bool>> _submit;
    private readonly Action _close;
    private readonly Func<string, string, CancellationToken, Task<string>>? _suggestName;
    private CancellationTokenSource? _suggestionFetch;
    private bool _nameWasTyped;
    private bool _applyingSuggestion;

    [ObservableProperty]
    private string _name = "";

    [ObservableProperty]
    private DeviceCategoryInfo _selectedCategory;

    [ObservableProperty]
    private PropertyOption? _selectedProperty;

    [ObservableProperty]
    private string _floor = "";

    [ObservableProperty]
    private string _floorLabel = "";

    [ObservableProperty]
    private string _ipAddress = "";

    [ObservableProperty]
    private string _macAddress = "";

    [ObservableProperty]
    private string _notes = "";

    [ObservableProperty]
    private double? _placedLatitude;

    [ObservableProperty]
    private double? _placedLongitude;

    [ObservableProperty]
    private IReadOnlyList<string> _validationErrors = [];

    [ObservableProperty]
    private string? _submitError;

    [ObservableProperty]
    private bool _isSubmitting;

    public DeviceFormViewModel(
        BimDevice? original,
        IReadOnlyList<PropertyOption> properties,
        Func<DeviceFormViewModel, CancellationToken, Task<bool>> submit,
        Action close,
        Func<string, string, CancellationToken, Task<string>>? suggestName = null,
        Action? relocate = null)
    {
        Original = original;
        Properties = properties;
        _submit = submit;
        _close = close;
        _suggestName = suggestName;
        Relocate = relocate;

        _selectedCategory = DeviceCategories.Resolve("ROUTER");
        if (original is not null)
        {
            _name = original.Name;
            _nameWasTyped = true;
            _selectedCategory = DeviceCategories.Resolve(original.Category);
            _selectedProperty = properties.FirstOrDefault(option => option.Id == original.PropertyId);
            _floor = original.Floor?.ToString(CultureInfo.InvariantCulture) ?? "";
            _floorLabel = original.FloorLabel ?? "";
            _ipAddress = original.IpAddress ?? "";
            _macAddress = original.MacAddress ?? "";
            _notes = original.Notes ?? "";
        }
    }

    /// <summary>Null when creating; the row being edited otherwise.</summary>
    public BimDevice? Original { get; }

    public bool IsEdit => Original is not null;

    public string Title => IsEdit ? "Edit device" : "Add device";

    public string SubmitLabel => IsEdit ? "Save changes" : "Add device";

    /// <summary>Every category, in the same order the web form offered them.</summary>
    public IReadOnlyList<DeviceCategoryInfo> Categories { get; } = DeviceCategories.All;

    public IReadOnlyList<PropertyOption> Properties { get; }

    /// <summary>Set by the map owner; the equipment tab has no map to relocate on.</summary>
    public Action? Relocate { get; }

    public bool CanRelocate => Relocate is not null && IsEdit;

    /// <summary>The read-only location line; coordinates are only ever set by a map pick.</summary>
    public string CoordinateLine
    {
        get
        {
            var latitude = PlacedLatitude ?? Original?.Latitude;
            var longitude = PlacedLongitude ?? Original?.Longitude;
            if (latitude is not { } lat || longitude is not { } lng)
            {
                return "No location - place it from the map";
            }

            var north = lat >= 0 ? "N" : "S";
            var east = lng >= 0 ? "E" : "W";
            return string.Create(
                CultureInfo.InvariantCulture,
                $"{Math.Abs(lat):F5}° {north}, {Math.Abs(lng):F5}° {east}");
        }
    }

    /// <summary>Structural validation mirroring <c>CreateDeviceRequest.Validate</c>.</summary>
    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        var name = Name.Trim();
        if (name.Length == 0)
        {
            errors.Add("Name is required.");
        }
        else if (name.Length > 100)
        {
            errors.Add("Name must be at most 100 characters.");
        }

        if (!IsEdit && SelectedProperty is null)
        {
            errors.Add("Pick the property this device lives on.");
        }

        if (ParsedFloor is null && Floor.Trim().Length > 0)
        {
            errors.Add("Floor must be a whole number from -10 to 200.");
        }

        if (FloorLabel.Trim().Length > 50)
        {
            errors.Add("Floor label must be at most 50 characters.");
        }

        if (IpAddress.Trim() is { Length: > 0 } ip && !IsIpAddress(ip))
        {
            errors.Add("IP address must be a valid IPv4 or IPv6 address.");
        }

        if (MacAddress.Trim() is { Length: > 0 } mac && !MacPattern().IsMatch(mac))
        {
            errors.Add("MAC address must be in XX:XX:XX:XX:XX:XX format.");
        }

        if (Notes.Length > 500)
        {
            errors.Add("Notes must be at most 500 characters.");
        }

        return errors;
    }

    /// <summary>The create body, once <see cref="Validate"/> came back clean.</summary>
    public CreateDevice BuildCreate(string networkId) => new(
        Name.Trim(),
        SelectedCategory.Category,
        networkId,
        SelectedProperty!.Id,
        PlacedLatitude,
        PlacedLongitude,
        ParsedFloor,
        NullIfEmpty(FloorLabel),
        NullIfEmpty(IpAddress),
        NullIfEmpty(MacAddress),
        NullIfEmpty(Notes));

    /// <summary>
    /// The minimal changeset against <see cref="Original"/>: only strictly-changed fields
    /// ride, cleared optionals ride as explicit nulls (absence would mean "keep").
    /// </summary>
    public IReadOnlyList<FieldChange> BuildChanges()
    {
        var original = Original!;
        var changes = new List<FieldChange>();
        AddIfChanged(changes, "name", original.Name, Name.Trim());
        AddIfChanged(changes, "category", original.Category, SelectedCategory.Category);
        AddIfChanged(changes, "floor", original.Floor, ParsedFloor);
        AddIfChanged(changes, "floorLabel", original.FloorLabel, NullIfEmpty(FloorLabel));
        AddIfChanged(changes, "ipAddress", original.IpAddress, NullIfEmpty(IpAddress));
        AddIfChanged(changes, "macAddress", original.MacAddress, NullIfEmpty(MacAddress));
        AddIfChanged(changes, "notes", original.Notes, NullIfEmpty(Notes));
        if (PlacedLatitude is not null && !NumbersEqual(original.Latitude, PlacedLatitude))
        {
            changes.Add(FieldChange.Of("latitude", original.Latitude, PlacedLatitude));
        }

        if (PlacedLongitude is not null && !NumbersEqual(original.Longitude, PlacedLongitude))
        {
            changes.Add(FieldChange.Of("longitude", original.Longitude, PlacedLongitude));
        }

        return changes;
    }

    [RelayCommand]
    private async Task SubmitAsync()
    {
        var errors = Validate();
        ValidationErrors = errors;
        if (errors.Count > 0)
        {
            return;
        }

        IsSubmitting = true;
        SubmitError = null;
        try
        {
            if (await _submit(this, CancellationToken.None))
            {
                _close();
            }
        }
        finally
        {
            IsSubmitting = false;
        }
    }

    [RelayCommand]
    private void Cancel() => _close();

    [RelayCommand]
    private void RequestRelocate() => Relocate?.Invoke();

    partial void OnNameChanged(string value)
    {
        if (!_applyingSuggestion)
        {
            _nameWasTyped = value.Trim().Length > 0;
        }
    }

    partial void OnSelectedCategoryChanged(DeviceCategoryInfo value) => RefreshSuggestion();

    partial void OnSelectedPropertyChanged(PropertyOption? value) => RefreshSuggestion();

    public bool HasValidationErrors => ValidationErrors.Count > 0;

    partial void OnValidationErrorsChanged(IReadOnlyList<string> value) =>
        OnPropertyChanged(nameof(HasValidationErrors));

    partial void OnPlacedLatitudeChanged(double? value) => OnPropertyChanged(nameof(CoordinateLine));

    partial void OnPlacedLongitudeChanged(double? value) => OnPropertyChanged(nameof(CoordinateLine));

    private int? ParsedFloor =>
        int.TryParse(Floor.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var floor)
        && floor is >= -10 and <= 200
            ? floor
            : null;

    /// <summary>
    /// Prefills the name with the server's "Router 2"-style suggestion, but only while
    /// the user has not typed one - a typed name is never overwritten.
    /// </summary>
    private void RefreshSuggestion()
    {
        if (_suggestName is null || IsEdit || _nameWasTyped || SelectedProperty is null)
        {
            return;
        }

        _suggestionFetch?.Cancel();
        _suggestionFetch?.Dispose();
        var fetch = new CancellationTokenSource();
        _suggestionFetch = fetch;
        var propertyId = SelectedProperty.Id;
        var category = SelectedCategory.Category;
        _ = SuggestAsync(propertyId, category, fetch.Token);
    }

    private async Task SuggestAsync(string propertyId, string category, CancellationToken cancellationToken)
    {
        try
        {
            var suggestion = await _suggestName!(propertyId, category, cancellationToken);
            if (!cancellationToken.IsCancellationRequested && !_nameWasTyped)
            {
                _applyingSuggestion = true;
                try
                {
                    Name = suggestion;
                }
                finally
                {
                    _applyingSuggestion = false;
                }
            }
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException or OperationCanceledException)
        {
            // A missing suggestion is not an error the form needs to surface.
        }
    }

    private static void AddIfChanged(List<FieldChange> changes, string field, object? oldValue, object? newValue)
    {
        var equal = (oldValue, newValue) switch
        {
            (null, null) => true,
            (string left, string right) => string.Equals(left, right, StringComparison.Ordinal),
            (int left, int right) => left == right,
            _ => false,
        };
        if (!equal)
        {
            changes.Add(FieldChange.Of(field, oldValue, newValue));
        }
    }

    private static bool NumbersEqual(double? left, double? right) =>
        left is { } a && right is { } b ? Math.Abs(a - b) < 1e-9 : left is null && right is null;

    private static string? NullIfEmpty(string value)
    {
        var trimmed = value.Trim();
        return trimmed.Length > 0 ? trimmed : null;
    }

    /// <summary>The server's validator.js-shaped rule: full dotted-quad v4 or a v6.</summary>
    private static bool IsIpAddress(string value) =>
        IPAddress.TryParse(value, out _)
        && (value.Contains(':', StringComparison.Ordinal)
            || value.Count(character => character == '.') == 3);

    [System.Text.RegularExpressions.GeneratedRegex("^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$")]
    private static partial System.Text.RegularExpressions.Regex MacPattern();
}
