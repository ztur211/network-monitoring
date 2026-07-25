using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using NodeScope.Desktop.Api;

namespace NodeScope.Desktop.ViewModels;

/// <summary>One choice in the circuit form's device-linkage picker; a null id is "None".</summary>
internal sealed record DeviceOption(string? Id, string Label);

/// <summary>
/// The circuit create/edit form. Validation mirrors <c>CreateCircuitRequest</c>;
/// the owner supplies the submit like the device form.
/// </summary>
[INotifyPropertyChanged]
internal sealed partial class CircuitFormViewModel
{
    /// <summary>The web form's service-type presets; free text stays allowed.</summary>
    public static readonly IReadOnlyList<string> ServiceTypePresets =
        ["Fiber", "Cable", "DSL", "Leased Line", "Wireless", "Other"];

    private readonly Func<CircuitFormViewModel, CancellationToken, Task<bool>> _submit;
    private readonly Action _close;

    [ObservableProperty]
    private string _ispName = "";

    [ObservableProperty]
    private string _serviceType = "";

    [ObservableProperty]
    private string _circuitId = "";

    [ObservableProperty]
    private string _bandwidth = "";

    [ObservableProperty]
    private DeviceOption _selectedDevice;

    [ObservableProperty]
    private string _notes = "";

    [ObservableProperty]
    private IReadOnlyList<string> _validationErrors = [];

    [ObservableProperty]
    private string? _submitError;

    [ObservableProperty]
    private bool _isSubmitting;

    public CircuitFormViewModel(
        Circuit? original,
        IReadOnlyList<DeviceOption> devices,
        Func<CircuitFormViewModel, CancellationToken, Task<bool>> submit,
        Action close)
    {
        Original = original;
        Devices = [new DeviceOption(null, "None"), .. devices];
        _submit = submit;
        _close = close;

        _selectedDevice = Devices[0];
        if (original is not null)
        {
            _ispName = original.IspName;
            _serviceType = original.ServiceType;
            _circuitId = original.CircuitId ?? "";
            _bandwidth = original.Bandwidth?.ToString(CultureInfo.InvariantCulture) ?? "";
            _notes = original.Notes ?? "";
            _selectedDevice = Devices.FirstOrDefault(option => option.Id == original.DeviceId) ?? Devices[0];
        }
    }

    public Circuit? Original { get; }

    public bool IsEdit => Original is not null;

    public string Title => IsEdit ? "Edit circuit" : "Add circuit";

    public string SubmitLabel => IsEdit ? "Save changes" : "Add circuit";

    public IReadOnlyList<DeviceOption> Devices { get; }

    public bool HasValidationErrors => ValidationErrors.Count > 0;

    partial void OnValidationErrorsChanged(IReadOnlyList<string> value) =>
        OnPropertyChanged(nameof(HasValidationErrors));

    [RelayCommand]
    private void PickPreset(string preset) => ServiceType = preset;

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        var isp = IspName.Trim();
        if (isp.Length == 0)
        {
            errors.Add("ISP name is required.");
        }
        else if (isp.Length > 100)
        {
            errors.Add("ISP name must be at most 100 characters.");
        }

        var serviceType = ServiceType.Trim();
        if (serviceType.Length == 0)
        {
            errors.Add("Service type is required.");
        }
        else if (serviceType.Length > 50)
        {
            errors.Add("Service type must be at most 50 characters.");
        }

        if (CircuitId.Trim().Length > 100)
        {
            errors.Add("Circuit ID must be at most 100 characters.");
        }

        if (ParsedBandwidth is null && Bandwidth.Trim().Length > 0)
        {
            errors.Add("Bandwidth must be a number from 0.1 to 100000 Mbps.");
        }

        if (Notes.Length > 500)
        {
            errors.Add("Notes must be at most 500 characters.");
        }

        return errors;
    }

    public CreateCircuit BuildCreate() => new(
        IspName.Trim(),
        NullIfEmpty(CircuitId),
        ServiceType.Trim(),
        ParsedBandwidth,
        SelectedDevice.Id,
        NullIfEmpty(Notes));

    public IReadOnlyList<FieldChange> BuildChanges()
    {
        var original = Original!;
        var changes = new List<FieldChange>();
        AddStringChange(changes, "ispName", original.IspName, IspName.Trim());
        AddStringChange(changes, "circuitId", original.CircuitId, NullIfEmpty(CircuitId));
        AddStringChange(changes, "serviceType", original.ServiceType, ServiceType.Trim());
        if (!NumbersEqual(original.Bandwidth, ParsedBandwidth))
        {
            changes.Add(FieldChange.Of("bandwidth", original.Bandwidth, ParsedBandwidth));
        }

        AddStringChange(changes, "deviceId", original.DeviceId, SelectedDevice.Id);
        AddStringChange(changes, "notes", original.Notes, NullIfEmpty(Notes));
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

    private double? ParsedBandwidth =>
        double.TryParse(Bandwidth.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
        && parsed is >= 0.1 and <= 100000
            ? parsed
            : null;

    private static void AddStringChange(List<FieldChange> changes, string field, string? oldValue, string? newValue)
    {
        if (!string.Equals(oldValue, newValue, StringComparison.Ordinal))
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
}
