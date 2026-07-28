using System.Globalization;
using System.Numerics;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Extensions.Logging;
using NodeScope.Contracts;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Bim;

namespace NodeScope.Desktop.ViewModels;

internal enum BimViewerState
{
    Loading,
    NoBuildings,
    NoModel,
    NoActiveVersion,
    NoGeometry,
    Ready,
    Error,
}

/// <summary>
/// Building selection and active wexBIM loading. Every selection owns a
/// cancellation generation, so a slow prior download can never replace the
/// model for the building currently shown in the picker.
/// </summary>
[INotifyPropertyChanged]
internal sealed partial class BimViewerViewModel : IDisposable
{
    private readonly ApplianceSession _session;
    private readonly ILogger<BimViewerViewModel> _logger;
    private readonly IIfcTessellator _tessellator;
    private readonly CancellationTokenSource _lifetime = new();
    private CancellationTokenSource? _selectionCancellation;
    private CancellationTokenSource? _importCancellation;
    private CancellationTokenSource? _statusPollingCancellation;
    private CancellationTokenSource? _telemetryCancellation;
    private CancellationTokenSource? _metricCancellation;
    private Task? _initialization;
    private bool _selectionChangesEnabled;
    private bool _telemetryChangesEnabled = true;
    private AccessSummary _access = new("VIEWER", [], false);
    private HashSet<int> _explicitlyHiddenProductLabels = [];
    private int? _isolatedProductLabel;

    [ObservableProperty]
    private IReadOnlyList<PropertySummary> _buildings = [];

    [ObservableProperty]
    private PropertySummary? _selectedBuilding;

    [ObservableProperty]
    private BimViewerState _state = BimViewerState.Loading;

    [ObservableProperty]
    private BimScene? _scene;

    [ObservableProperty]
    private BuildingModelSummary? _model;

    [ObservableProperty]
    private string? _errorDetails;

    [ObservableProperty]
    private bool _isImporting;

    [ObservableProperty]
    private string? _importStatus;

    [ObservableProperty]
    private string? _importError;

    [ObservableProperty]
    private bool _hasElementMetadata;

    [ObservableProperty]
    private IReadOnlyList<BimCategoryItem> _categories = [];

    [ObservableProperty]
    private BimProduct? _selectedProduct;

    [ObservableProperty]
    private IReadOnlyList<BimDeviceItem> _devices = [];

    [ObservableProperty]
    private BimDeviceItem? _selectedDevice;

    [ObservableProperty]
    private IReadOnlyList<BimFloorOption> _floorOptions =
        [new BimFloorOption("All floors", null)];

    [ObservableProperty]
    private BimFloorOption? _selectedFloor;

    [ObservableProperty]
    private BimInteractionMode _interactionMode;

    [ObservableProperty]
    private bool _sectionEnabled;

    [ObservableProperty]
    private BimSectionAxis _sectionAxis = BimSectionAxis.Z;

    [ObservableProperty]
    private double _sectionPosition = 100d;

    [ObservableProperty]
    private BimRenderOptions _renderOptions = BimRenderOptions.Empty;

    [ObservableProperty]
    private string? _operationError;

    [ObservableProperty]
    private IReadOnlyList<string> _metricNames = [];

    [ObservableProperty]
    private string? _selectedMetricName;

    [ObservableProperty]
    private BimMetricSeries? _metricSeries;

    [ObservableProperty]
    private IReadOnlyList<BimStatusEventItem> _statusEvents = [];

    [ObservableProperty]
    private IReadOnlyList<BcfTopicSummary> _bcfTopics = [];

    [ObservableProperty]
    private BcfTopicSummary? _selectedBcfTopic;

    [ObservableProperty]
    private string _newIssueTitle = string.Empty;

    [ObservableProperty]
    private string _newIssuePriority = "NORMAL";

    [ObservableProperty]
    private bool _isCreatingIssue;

    [ObservableProperty]
    private string _georeferenceLatitudeInput = "";

    [ObservableProperty]
    private string _georeferenceLongitudeInput = "";

    [ObservableProperty]
    private string _georeferenceRotationInput = "";

    [ObservableProperty]
    private bool _isSavingGeoreference;

    public BimViewerViewModel(
        ApplianceSession session,
        ILogger<BimViewerViewModel> logger,
        IIfcTessellator tessellator)
    {
        _session = session;
        _logger = logger;
        _tessellator = tessellator;
        Camera = new BimCamera();
    }

    public Task Initialization => _initialization ??= BeginInitialization();

    internal Task CurrentLoad { get; private set; } = Task.CompletedTask;

    public BimCamera Camera { get; }

    public bool IsLoading => State == BimViewerState.Loading;

    public bool IsReady => State == BimViewerState.Ready;

    public bool HasStatus => State is not BimViewerState.Loading and not BimViewerState.Ready;

    public bool CanRetry => State is BimViewerState.Error or BimViewerState.NoGeometry;

    public bool IsImportSupported => _tessellator.IsSupported;

    public bool CanImport =>
        IsImportSupported && SelectedBuilding is not null && !IsImporting;

    public bool HasImportError => ImportError is not null;

    public IReadOnlyList<BimSectionAxis> SectionAxes { get; } =
        Enum.GetValues<BimSectionAxis>();

    public IReadOnlyList<string> IssuePriorities { get; } =
        ["LOW", "NORMAL", "HIGH", "CRITICAL"];

    public string ElementMetadataCaption => HasElementMetadata
        ? "IFC identity index available"
        : "Re-import this model to enable IFC identity linking";

    public bool HasOperationError => OperationError is not null;

    public bool CanConfigure => _access.CanConfigure;

    public bool HasSelection => SelectedProduct is not null || SelectedDevice is not null;

    public bool HasSelectedProduct => SelectedProduct is not null;

    public bool HasSelectedDevice => SelectedDevice is not null;

    public bool CanPlaceSelectedDevice =>
        CanConfigure && SelectedDevice is not null && Scene is not null;

    public bool CanLinkSelectedDevice =>
        CanConfigure && SelectedDevice is not null && HasElementMetadata;

    public bool CanClearSelectedDevicePosition =>
        CanConfigure && SelectedDevice is { IsPlaced: true };

    public bool CanClearSelectedDeviceLink =>
        CanConfigure && SelectedDevice is { IsLinked: true };

    public bool CanFocusSelection =>
        Scene is not null
        && (SelectedProduct is not null || SelectedDevice is { IsPlaced: true });

    public bool HasGeoreference => Model?.Georeference is not null;

    public bool CanEditGeoreference => CanConfigure && Model is not null;

    /// <summary>The map-anchor state line shown in the Model tab.</summary>
    public string GeoreferenceCaption => Model?.Georeference is { } georeference
        ? string.Create(
            CultureInfo.InvariantCulture,
            $"Anchored at {georeference.AnchorLatitude:0.######}°, {georeference.AnchorLongitude:0.######}° · true north {georeference.RotationDegrees:0.##}°. Placed devices appear on the map at their model position.")
        : "Not georeferenced. Set the building's coordinates so placed devices appear on the map where they stand in the model.";

    public bool IsInteractionPending => InteractionMode is not BimInteractionMode.Select;

    public bool PickProductsOnly => InteractionMode is not BimInteractionMode.Select;

    public string InteractionHint => InteractionMode switch
    {
        BimInteractionMode.PlaceDevice =>
            $"Click a model surface to place {SelectedDevice?.Name ?? "the device"}",
        BimInteractionMode.LinkDevice =>
            $"Click an IFC element to link {SelectedDevice?.Name ?? "the device"}",
        _ => "Drag to orbit. Shift-drag or right-drag to pan. Scroll to zoom.",
    };

    public string SelectedProductCaption => SelectedProduct is null
        ? "No IFC element selected"
        : SelectedProduct.Name
            ?? SelectedProduct.TypeName
            ?? $"IFC type {SelectedProduct.Type}";

    public string SectionCaption => Scene is null
        ? string.Empty
        : $"{SectionAxis} {SectionConstant:0.###}";

    public int UpCount => FilteredDevices().Count(static device => device.State == "UP");

    public int DownCount => FilteredDevices().Count(static device => device.State == "DOWN");

    public int WarningCount => FilteredDevices().Count(static device => device.State == "WARNING");

    public int UnknownCount => FilteredDevices().Count(static device => device.State == "UNKNOWN");

    public int PlacedDeviceCount => Devices.Count(static device => device.IsPlaced);

    public IReadOnlyList<BimDeviceItem> HealthDevices =>
    [
        .. FilteredDevices()
            .OrderBy(static device => device.Severity)
            .ThenBy(static device => device.Name, StringComparer.CurrentCultureIgnoreCase),
    ];

    public bool CanCreateIssue =>
        CanConfigure
        && !IsCreatingIssue
        && SelectedBuilding is not null
        && !string.IsNullOrWhiteSpace(NewIssueTitle);

    public bool HasNoBcfTopics => BcfTopics.Count == 0;

    public bool CanOpenSelectedIssue => SelectedBcfTopic is not null;

    internal Task CurrentTelemetryLoad { get; private set; } = Task.CompletedTask;

    internal Task CurrentMetricLoad { get; private set; } = Task.CompletedTask;

    public string ImportButtonText => IsImportSupported
        ? "Import IFC"
        : "Import IFC on Windows";

    public string ImportToolTip => IsImportSupported
        ? "Tessellate and upload a new IFC model version"
        : "IFC tessellation currently requires NodeScope Desktop on Windows";

    public string StatusTitle => State switch
    {
        BimViewerState.NoBuildings => "No buildings in scope",
        BimViewerState.NoModel => "No building model",
        BimViewerState.NoActiveVersion => "No active model version",
        BimViewerState.NoGeometry => "3D geometry is not ready",
        _ => "The model could not be opened",
    };

    public string StatusMessage => State switch
    {
        BimViewerState.NoBuildings =>
            "Create a building in Inventory before opening the 3D viewer.",
        BimViewerState.NoModel when IsImportSupported =>
            "Import an IFC model for this building to create its first 3D version.",
        BimViewerState.NoModel =>
            "Import an IFC model from NodeScope Desktop on Windows to create the first 3D version.",
        BimViewerState.NoActiveVersion =>
            "Activate a model version before opening it in the viewer.",
        BimViewerState.NoGeometry when IsImportSupported =>
            "The active IFC version has no portable render artifact. Re-import it from the Windows desktop client.",
        BimViewerState.NoGeometry =>
            "The active IFC version has no portable render artifact. Re-import it from NodeScope Desktop on Windows.",
        _ => ErrorDetails ?? "Check the appliance connection and try again.",
    };

    public string ModelCaption => Model?.ActiveVersionId is { Length: > 0 } version
        ? string.Create(
            CultureInfo.InvariantCulture,
            $"{Model.Name} · {version[..Math.Min(8, version.Length)]}")
        : "Active model";

    public string GeometryCaption => Scene is null
        ? string.Empty
        : string.Create(
            CultureInfo.CurrentCulture,
            $"{Scene.TriangleCount:N0} triangles · {Scene.VisibleProductCount:N0} products · wexBIM v{Scene.FormatVersion}");

    public void Dispose()
    {
        _selectionChangesEnabled = false;
        _lifetime.Cancel();
        _selectionCancellation?.Cancel();
        _selectionCancellation?.Dispose();
        _importCancellation?.Cancel();
        _importCancellation?.Dispose();
        _statusPollingCancellation?.Cancel();
        _statusPollingCancellation?.Dispose();
        _telemetryCancellation?.Cancel();
        _telemetryCancellation?.Dispose();
        _metricCancellation?.Cancel();
        _metricCancellation?.Dispose();
        _lifetime.Dispose();
    }

    partial void OnSelectedBuildingChanged(PropertySummary? value)
    {
        _importCancellation?.Cancel();
        OnPropertyChanged(nameof(CanImport));
        OnPropertyChanged(nameof(CanCreateIssue));
        if (_selectionChangesEnabled)
        {
            CurrentLoad = value is null
                ? SetNoBuildingsAsync()
                : LoadBuildingAsync(value);
        }
    }

    partial void OnStateChanged(BimViewerState value)
    {
        OnPropertyChanged(nameof(IsLoading));
        OnPropertyChanged(nameof(IsReady));
        OnPropertyChanged(nameof(HasStatus));
        OnPropertyChanged(nameof(CanRetry));
        OnPropertyChanged(nameof(StatusTitle));
        OnPropertyChanged(nameof(StatusMessage));
    }

    partial void OnSceneChanged(BimScene? value)
    {
        OnPropertyChanged(nameof(GeometryCaption));
        OnPropertyChanged(nameof(SectionCaption));
        OnPropertyChanged(nameof(CanFocusSelection));
        FocusSelectionCommand.NotifyCanExecuteChanged();
        RefreshRenderOptions();
    }

    partial void OnModelChanged(BuildingModelSummary? value)
    {
        OnPropertyChanged(nameof(ModelCaption));
        OnPropertyChanged(nameof(HasGeoreference));
        OnPropertyChanged(nameof(GeoreferenceCaption));
        OnPropertyChanged(nameof(CanEditGeoreference));
        var georeference = value?.Georeference;
        GeoreferenceLatitudeInput = georeference is null
            ? ""
            : georeference.AnchorLatitude.ToString("0.######", CultureInfo.InvariantCulture);
        GeoreferenceLongitudeInput = georeference is null
            ? ""
            : georeference.AnchorLongitude.ToString("0.######", CultureInfo.InvariantCulture);
        GeoreferenceRotationInput = georeference is null
            ? ""
            : georeference.RotationDegrees.ToString("0.##", CultureInfo.InvariantCulture);
    }

    partial void OnErrorDetailsChanged(string? value) =>
        OnPropertyChanged(nameof(StatusMessage));

    partial void OnIsImportingChanged(bool value) =>
        OnPropertyChanged(nameof(CanImport));

    partial void OnImportErrorChanged(string? value) =>
        OnPropertyChanged(nameof(HasImportError));

    partial void OnHasElementMetadataChanged(bool value)
    {
        OnPropertyChanged(nameof(CanLinkSelectedDevice));
        OnPropertyChanged(nameof(ElementMetadataCaption));
    }

    partial void OnCategoriesChanged(IReadOnlyList<BimCategoryItem> value) =>
        RefreshRenderOptions();

    partial void OnSelectedProductChanged(BimProduct? value)
    {
        OnPropertyChanged(nameof(HasSelection));
        OnPropertyChanged(nameof(HasSelectedProduct));
        OnPropertyChanged(nameof(SelectedProductCaption));
        OnPropertyChanged(nameof(CanFocusSelection));
        FocusSelectionCommand.NotifyCanExecuteChanged();
        RefreshRenderOptions();
    }

    partial void OnDevicesChanged(IReadOnlyList<BimDeviceItem> value)
    {
        NotifyDeviceSummaryChanged();
        RefreshRenderOptions();
    }

    partial void OnSelectedDeviceChanged(BimDeviceItem? value)
    {
        OnPropertyChanged(nameof(HasSelection));
        OnPropertyChanged(nameof(HasSelectedDevice));
        OnPropertyChanged(nameof(CanPlaceSelectedDevice));
        OnPropertyChanged(nameof(CanLinkSelectedDevice));
        OnPropertyChanged(nameof(CanClearSelectedDevicePosition));
        OnPropertyChanged(nameof(CanClearSelectedDeviceLink));
        OnPropertyChanged(nameof(CanFocusSelection));
        ClearDevicePositionCommand.NotifyCanExecuteChanged();
        ClearDeviceLinkCommand.NotifyCanExecuteChanged();
        FocusSelectionCommand.NotifyCanExecuteChanged();
        RefreshRenderOptions();
        if (_telemetryChangesEnabled)
        {
            CurrentTelemetryLoad = LoadTelemetryAsync(value);
        }
    }

    partial void OnSelectedFloorChanged(BimFloorOption? value)
    {
        NotifyDeviceSummaryChanged();
        RefreshRenderOptions();
    }

    partial void OnInteractionModeChanged(BimInteractionMode value)
    {
        OnPropertyChanged(nameof(IsInteractionPending));
        OnPropertyChanged(nameof(PickProductsOnly));
        OnPropertyChanged(nameof(InteractionHint));
    }

    partial void OnSectionEnabledChanged(bool value)
    {
        OnPropertyChanged(nameof(SectionCaption));
        RefreshRenderOptions();
    }

    partial void OnSectionAxisChanged(BimSectionAxis value)
    {
        OnPropertyChanged(nameof(SectionCaption));
        RefreshRenderOptions();
    }

    partial void OnSectionPositionChanged(double value)
    {
        OnPropertyChanged(nameof(SectionCaption));
        RefreshRenderOptions();
    }

    partial void OnOperationErrorChanged(string? value) =>
        OnPropertyChanged(nameof(HasOperationError));

    partial void OnBcfTopicsChanged(IReadOnlyList<BcfTopicSummary> value) =>
        OnPropertyChanged(nameof(HasNoBcfTopics));

    partial void OnSelectedBcfTopicChanged(BcfTopicSummary? value)
    {
        OnPropertyChanged(nameof(CanOpenSelectedIssue));
        ApplySelectedIssueCommand.NotifyCanExecuteChanged();
    }

    partial void OnSelectedMetricNameChanged(string? value)
    {
        if (_telemetryChangesEnabled)
        {
            CurrentMetricLoad = LoadMetricAsync(value);
        }
    }

    partial void OnNewIssueTitleChanged(string value) =>
        OnPropertyChanged(nameof(CanCreateIssue));

    partial void OnIsCreatingIssueChanged(bool value) =>
        OnPropertyChanged(nameof(CanCreateIssue));

    [RelayCommand]
    private Task RetryAsync() => SelectedBuilding is null
        ? InitializeAsync()
        : LoadBuildingAsync(SelectedBuilding);

    [RelayCommand]
    private void Fit() => SceneFit();

    [RelayCommand]
    private void Isometric() => Camera.SetPreset(BimViewPreset.Isometric);

    [RelayCommand]
    private void Front() => Camera.SetPreset(BimViewPreset.Front);

    [RelayCommand]
    private void Right() => Camera.SetPreset(BimViewPreset.Right);

    [RelayCommand]
    private void Top() => Camera.SetPreset(BimViewPreset.Top);

    [RelayCommand(CanExecute = nameof(CanFocusSelection))]
    private void FocusSelection()
    {
        if (Scene is null)
        {
            return;
        }

        if (SelectedDevice is { Device.IsPlaced: true } selectedDevice)
        {
            var visual = ToVisual(selectedDevice);
            Camera.Focus(BimDeviceMeshes.Bounds(Scene, visual));
        }
        else if (SelectedProduct is { } product)
        {
            Camera.Focus(product.Bounds);
        }
    }

    [RelayCommand]
    private void ToggleCategory(BimCategoryItem? category)
    {
        if (category is null)
        {
            return;
        }

        Categories =
        [
            .. Categories.Select(item =>
                string.Equals(item.Name, category.Name, StringComparison.Ordinal)
                    ? item with { IsVisible = !item.IsVisible }
                    : item),
        ];
    }

    [RelayCommand]
    private void ShowAll()
    {
        _explicitlyHiddenProductLabels = [];
        _isolatedProductLabel = null;
        Categories =
        [
            .. Categories.Select(static category => category with { IsVisible = true }),
        ];
        RefreshRenderOptions();
    }

    [RelayCommand]
    private void HideSelected()
    {
        if (SelectedProduct is null)
        {
            return;
        }

        _explicitlyHiddenProductLabels =
        [
            .. _explicitlyHiddenProductLabels,
            SelectedProduct.Label,
        ];
        _isolatedProductLabel = null;
        SelectedProduct = null;
        RefreshRenderOptions();
    }

    [RelayCommand]
    private void IsolateSelected()
    {
        _isolatedProductLabel = SelectedProduct?.Label;
        RefreshRenderOptions();
    }

    [RelayCommand]
    private void BeginPlaceDevice()
    {
        if (CanPlaceSelectedDevice)
        {
            OperationError = null;
            InteractionMode = BimInteractionMode.PlaceDevice;
        }
    }

    [RelayCommand]
    private void BeginLinkDevice()
    {
        if (CanLinkSelectedDevice)
        {
            OperationError = null;
            InteractionMode = BimInteractionMode.LinkDevice;
        }
    }

    [RelayCommand]
    private void CancelInteraction() => InteractionMode = BimInteractionMode.Select;

    [RelayCommand(CanExecute = nameof(CanClearSelectedDevicePosition))]
    private Task ClearDevicePositionAsync() =>
        SelectedDevice is null
            ? Task.CompletedTask
            : UpdateDevicePositionAsync(SelectedDevice, null, null, null);

    [RelayCommand(CanExecute = nameof(CanClearSelectedDeviceLink))]
    private Task ClearDeviceLinkAsync() =>
        SelectedDevice is null
            ? Task.CompletedTask
            : UpdateDeviceLinkAsync(SelectedDevice, null);

    [RelayCommand]
    private void FlyToDevice(BimDeviceItem? device)
    {
        if (device is null)
        {
            return;
        }

        SelectedDevice = device;
        SelectedProduct = null;
        FocusSelection();
    }

    [RelayCommand(CanExecute = nameof(CanOpenSelectedIssue))]
    private Task ApplySelectedIssueAsync() =>
        SelectedBcfTopic is null
            ? Task.CompletedTask
            : ApplyBcfTopicAsync(SelectedBcfTopic.Id);

    [RelayCommand]
    private void DismissOperationError() => OperationError = null;

    [RelayCommand]
    private void CancelImport() => _importCancellation?.Cancel();

    [RelayCommand]
    private void DismissImportError() => ImportError = null;

    /// <summary>
    /// A failed seed must not fail an import whose model already landed - the viewer works,
    /// only the automatic map anchor is missing, and the georeference panel can set it later.
    /// </summary>
    private async Task<BuildingModelSummary> SeedGeoreferenceAsync(
        string buildingId,
        BimGeoreference extracted,
        BuildingModelSummary fallback)
    {
        try
        {
            return await _session.Client.SetModelGeoreferenceAsync(
                _session.Token,
                buildingId,
                new ModelGeoreferenceSummary(
                    extracted.AnchorLatitude,
                    extracted.AnchorLongitude,
                    extracted.AnchorX,
                    extracted.AnchorY,
                    extracted.RotationDegrees,
                    extracted.MetersPerUnit),
                _lifetime.Token);
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or JsonException)
        {
            BimLog.GeoreferenceSeedFailed(_logger, buildingId, failure.Message);
            return fallback;
        }
    }

    internal async Task ImportFileAsync(string sourcePath, string fileName)
    {
        if (!IsImportSupported)
        {
            ImportError = "IFC import currently requires NodeScope Desktop on Windows.";
            return;
        }

        if (SelectedBuilding is not { } building || IsImporting)
        {
            return;
        }

        _importCancellation?.Dispose();
        _importCancellation = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
        var cancellationToken = _importCancellation.Token;
        IsImporting = true;
        ImportError = null;
        string? incompleteVersionId = null;

        try
        {
            ImportStatus = "Reading IFC and preparing 3D geometry";
            var tessellated = await _tessellator.TessellateAsync(sourcePath, cancellationToken);

            ImportStatus = "Uploading the immutable IFC source";
            BuildingModelVersionSummary version;
            await using (var source = new FileStream(
                             sourcePath,
                             FileMode.Open,
                             FileAccess.Read,
                             FileShare.Read,
                             bufferSize: 81920,
                             FileOptions.Asynchronous | FileOptions.SequentialScan))
            {
                version = await _session.Client.UploadModelVersionAsync(
                    _session.Token,
                    building.Id,
                    fileName,
                    source,
                    cancellationToken);
            }

            incompleteVersionId = version.Id;

            ImportStatus = "Uploading portable 3D geometry";
            await _session.Client.UploadModelGeometryAsync(
                _session.Token,
                building.Id,
                version.Id,
                tessellated.WexBim,
                cancellationToken);

            ImportStatus = "Uploading the IFC element index";
            await _session.Client.UploadModelMetadataAsync(
                _session.Token,
                building.Id,
                version.Id,
                tessellated.Elements,
                cancellationToken);

            ImportStatus = "Activating the completed model version";
            var activatedModel = await _session.Client.ActivateModelVersionAsync(
                _session.Token,
                building.Id,
                version.Id,
                _lifetime.Token);
            incompleteVersionId = null;

            // Seed the map anchor from the IFC's own georeferencing, but never clobber one
            // already set (a manual anchor outranks whatever a re-imported file claims).
            if (tessellated.Georeference is { } extracted && activatedModel.Georeference is null)
            {
                ImportStatus = "Georeferencing the model from the IFC site";
                activatedModel = await SeedGeoreferenceAsync(building.Id, extracted, activatedModel);
            }
            if (!string.Equals(
                    SelectedBuilding?.Id,
                    building.Id,
                    StringComparison.Ordinal))
            {
                return;
            }

            Model = activatedModel;
            Scene = EnrichScene(tessellated.Scene, tessellated.Elements);
            HasElementMetadata = tessellated.Elements.Count > 0;
            InitializeSceneInteractions();
            await LoadOperationalDataAsync(building.Id, _lifetime.Token);
            SceneFit();
            State = BimViewerState.Ready;
            BimLog.ImportCompleted(
                _logger,
                building.Id,
                version.Id,
                tessellated.WexBim.Length);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception failure) when (
            failure is ApplianceApiException
                or HttpRequestException
                or IOException
                or UnauthorizedAccessException
                or InvalidDataException)
        {
            BimLog.ImportFailed(_logger, building.Id, fileName, failure.Message);
            ImportError = ImportFailureMessage(failure);
        }
        finally
        {
            if (incompleteVersionId is not null)
            {
                await DeleteIncompleteVersionAsync(building.Id, incompleteVersionId);
            }

            ImportStatus = null;
            IsImporting = false;
        }
    }

    private async Task InitializeAsync()
    {
        _selectionChangesEnabled = false;
        SetLoading();
        try
        {
            var properties = await _session.Client.GetPropertiesAsync(
                _session.Token,
                _lifetime.Token);
            Buildings =
            [
                .. properties
                    .Where(static property =>
                        string.Equals(property.Type, "BUILDING", StringComparison.Ordinal))
                    .OrderBy(static property => property.Name, StringComparer.CurrentCultureIgnoreCase),
            ];

            if (Buildings.Count == 0)
            {
                SelectedBuilding = null;
                State = BimViewerState.NoBuildings;
                return;
            }

            SelectedBuilding = Buildings[0];
            await LoadBuildingAsync(SelectedBuilding);
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or JsonException)
        {
            SetError(failure, "loading the building list");
        }
        finally
        {
            _selectionChangesEnabled = true;
        }
    }

    private Task BeginInitialization()
    {
        CurrentLoad = InitializeAsync();
        return CurrentLoad;
    }

    private async Task LoadBuildingAsync(PropertySummary building)
    {
        var current = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
        var cancellationToken = current.Token;
        var previous = Interlocked.Exchange(ref _selectionCancellation, current);
        if (previous is not null)
        {
            await previous.CancelAsync();
            previous.Dispose();
        }

        if (cancellationToken.IsCancellationRequested)
        {
            return;
        }

        SetLoading();

        try
        {
            Model = await _session.Client.GetBuildingModelAsync(
                _session.Token,
                building.Id,
                cancellationToken);
            if (Model.ActiveVersionId is null)
            {
                State = BimViewerState.NoActiveVersion;
                return;
            }

            var content = await _session.Client.GetActiveModelGeometryAsync(
                _session.Token,
                building.Id,
                cancellationToken);
            var parsed = await Task.Run(
                () => WexBimReader.Read(content, cancellationToken),
                cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            BuildingModelMetadataSummary? metadata = null;
            try
            {
                metadata = await _session.Client.GetActiveModelMetadataAsync(
                    _session.Token,
                    building.Id,
                    cancellationToken);
            }
            catch (ApplianceApiException failure) when (failure.Code == "MODEL_012")
            {
                BimLog.MetadataMissing(_logger, building.Id);
            }

            Scene = metadata is null
                ? parsed
                : EnrichScene(parsed, metadata.Elements);
            HasElementMetadata = metadata?.Elements.Count > 0;
            InitializeSceneInteractions();
            await LoadOperationalDataAsync(building.Id, cancellationToken);
            SceneFit();
            State = BimViewerState.Ready;
            StartStatusPolling(building.Id, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (ApplianceApiException failure) when (failure.Code == "MODEL_001")
        {
            State = BimViewerState.NoModel;
        }
        catch (ApplianceApiException failure) when (failure.Code == "MODEL_004")
        {
            State = BimViewerState.NoActiveVersion;
        }
        catch (ApplianceApiException failure) when (failure.Code == "MODEL_009")
        {
            BimLog.GeometryMissing(_logger, building.Id);
            State = BimViewerState.NoGeometry;
        }
        catch (Exception failure) when (
            failure is ApplianceApiException
                or HttpRequestException
                or InvalidDataException
                or JsonException
                or OverflowException)
        {
            SetError(failure, $"loading model geometry for {building.Name}");
        }
    }

    internal async Task HandlePickAsync(BimPickResult? result)
    {
        OperationError = null;
        if (InteractionMode == BimInteractionMode.PlaceDevice)
        {
            if (SelectedDevice is null || result is not { Kind: BimPickKind.Product })
            {
                OperationError = "Click a visible model surface to place the device.";
                return;
            }

            var device = SelectedDevice;
            InteractionMode = BimInteractionMode.Select;
            await UpdateDevicePositionAsync(
                device,
                result.Point.X,
                result.Point.Y,
                result.Point.Z);
            return;
        }

        if (InteractionMode == BimInteractionMode.LinkDevice)
        {
            if (SelectedDevice is null
                || result is not { Kind: BimPickKind.Product, ProductLabel: { } label }
                || Scene?.Products.GetValueOrDefault(label) is not { GlobalId: { } globalId })
            {
                OperationError =
                    "Choose an indexed IFC element. Older models must be re-imported before linking.";
                return;
            }

            var device = SelectedDevice;
            InteractionMode = BimInteractionMode.Select;
            await UpdateDeviceLinkAsync(device, globalId);
            return;
        }

        if (result is { Kind: BimPickKind.Device, DeviceId: { } deviceId })
        {
            SelectedProduct = null;
            SelectedDevice = Devices.FirstOrDefault(device =>
                string.Equals(device.Id, deviceId, StringComparison.Ordinal));
        }
        else if (result is { Kind: BimPickKind.Product, ProductLabel: { } productLabel })
        {
            SelectedDevice = null;
            SelectedProduct = Scene?.Products.GetValueOrDefault(productLabel);
        }
        else
        {
            SelectedDevice = null;
            SelectedProduct = null;
        }
    }

    internal async Task CreateIssueAsync(byte[] snapshotPng)
    {
        ArgumentNullException.ThrowIfNull(snapshotPng);
        if (!CanCreateIssue || SelectedBuilding is null)
        {
            return;
        }

        IsCreatingIssue = true;
        OperationError = null;
        try
        {
            var camera = Camera.Snapshot(16d / 9d);
            var components = CaptureBcfComponents();
            var created = await _session.Client.CreateBcfTopicAsync(
                _session.Token,
                SelectedBuilding.Id,
                new CreateBcfTopic(
                    NewIssueTitle.Trim(),
                    "Issue",
                    "OPEN",
                    NewIssuePriority,
                    ["NodeScope Desktop"],
                    null,
                    null,
                    null,
                    [
                        new CreateBcfViewpoint(
                            null,
                            new BcfCamera(
                                "perspective",
                                Coordinates(camera.Eye),
                                Coordinates(camera.Direction),
                                Coordinates(camera.Up),
                                camera.FieldOfViewDegrees,
                                null),
                            components,
                            true,
                            Convert.ToBase64String(snapshotPng)),
                    ]),
                _lifetime.Token);
            BcfTopics =
            [
                ToSummary(created),
                .. BcfTopics.Where(topic =>
                    !string.Equals(topic.Id, created.Id, StringComparison.Ordinal)),
            ];
            SelectedBcfTopic = BcfTopics[0];
            NewIssueTitle = string.Empty;
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or JsonException)
        {
            SetOperationFailure("The issue could not be created.", failure);
        }
        finally
        {
            IsCreatingIssue = false;
        }
    }

    private void InitializeSceneInteractions()
    {
        _explicitlyHiddenProductLabels = [];
        _isolatedProductLabel = null;
        SelectedProduct = null;
        InteractionMode = BimInteractionMode.Select;
        SectionEnabled = false;
        SectionAxis = BimSectionAxis.Z;
        SectionPosition = 100d;
        Categories = Scene is null
            ? []
            :
            [
                .. Scene.Products.Values
                    .GroupBy(CategoryName, StringComparer.Ordinal)
                    .Select(group => new BimCategoryItem(
                        group.Key,
                        group.Count(),
                        true))
                    .OrderBy(
                        static category => category.Name,
                        StringComparer.CurrentCultureIgnoreCase),
            ];
        RefreshRenderOptions();
    }

    private async Task LoadOperationalDataAsync(
        string propertyId,
        CancellationToken cancellationToken)
    {
        var accessTask = TryLoadAsync(
            () => _session.Client.GetAccessSummaryAsync(
                _session.Token,
                cancellationToken),
            new AccessSummary("VIEWER", [], false));
        var devicesTask = TryLoadAsync(
            () => _session.Client.GetBuildingDevicesAsync(
                _session.Token,
                propertyId,
                cancellationToken),
            (IReadOnlyList<BimDevice>)[]);
        var statusesTask = TryLoadAsync(
            () => _session.Client.GetBuildingDeviceStatusAsync(
                _session.Token,
                propertyId,
                cancellationToken),
            (IReadOnlyList<BimDeviceStatus>)[]);
        var topicsTask = TryLoadAsync(
            () => _session.Client.GetBcfTopicsAsync(
                _session.Token,
                propertyId,
                cancellationToken),
            (IReadOnlyList<BcfTopicSummary>)[]);

        var accessResult = await accessTask;
        var devicesResult = await devicesTask;
        var statusesResult = await statusesTask;
        var topicsResult = await topicsTask;
        cancellationToken.ThrowIfCancellationRequested();

        _access = accessResult.Value;
        OnPropertyChanged(nameof(CanConfigure));
        OnPropertyChanged(nameof(CanPlaceSelectedDevice));
        OnPropertyChanged(nameof(CanLinkSelectedDevice));
        OnPropertyChanged(nameof(CanClearSelectedDevicePosition));
        OnPropertyChanged(nameof(CanClearSelectedDeviceLink));
        OnPropertyChanged(nameof(CanCreateIssue));
        OnPropertyChanged(nameof(CanEditGeoreference));
        ClearDevicePositionCommand.NotifyCanExecuteChanged();
        ClearDeviceLinkCommand.NotifyCanExecuteChanged();
        ApplyDeviceData(devicesResult.Value, statusesResult.Value);
        BcfTopics =
        [
            .. topicsResult.Value.OrderBy(
                static topic => topic.Title,
                StringComparer.CurrentCultureIgnoreCase),
        ];
        var failures = new[]
        {
            accessResult.Failure,
            devicesResult.Failure,
            statusesResult.Failure,
            topicsResult.Failure,
        }.Where(static failure => failure is not null).ToList();
        OperationError = failures.Count == 0
            ? null
            : "Some building operations are temporarily unavailable. The 3D model remains usable.";
    }

    private async Task<(T Value, Exception? Failure)> TryLoadAsync<T>(
        Func<Task<T>> load,
        T fallback)
    {
        try
        {
            return (await load(), null);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or JsonException)
        {
            BimLog.OperationFailed(_logger, failure.Message);
            return (fallback, failure);
        }
    }

    private void ApplyDeviceData(
        IReadOnlyList<BimDevice> devices,
        IReadOnlyList<BimDeviceStatus> statuses)
    {
        var selectedId = SelectedDevice?.Id;
        var statusByDevice = statuses
            .GroupBy(static status => status.DeviceId, StringComparer.Ordinal)
            .ToDictionary(
                static group => group.Key,
                static group => group.Last(),
                StringComparer.Ordinal);
        _telemetryChangesEnabled = false;
        Devices =
        [
            .. devices
                .Select(device => new BimDeviceItem(
                    device,
                    statusByDevice.GetValueOrDefault(device.Id)))
                .OrderBy(static device => device.Severity)
                .ThenBy(
                    static device => device.Name,
                    StringComparer.CurrentCultureIgnoreCase),
        ];
        SelectedDevice = selectedId is null
            ? null
            : Devices.FirstOrDefault(device =>
                string.Equals(device.Id, selectedId, StringComparison.Ordinal));
        _telemetryChangesEnabled = true;

        var selectedFloor = SelectedFloor?.Floor;
        FloorOptions =
        [
            new BimFloorOption("All floors", null),
            .. Devices
                .Where(static device => device.Floor is not null)
                .GroupBy(static device => device.Floor)
                .OrderBy(static group => group.Key)
                .Select(group => new BimFloorOption(
                    group.Select(static device => device.Device.FloorLabel)
                        .FirstOrDefault(static label => !string.IsNullOrWhiteSpace(label))
                        ?? $"Floor {group.Key}",
                    group.Key)),
        ];
        SelectedFloor = FloorOptions.FirstOrDefault(option =>
            option.Floor == selectedFloor) ?? FloorOptions[0];
        RefreshRenderOptions();
    }

    private void StartStatusPolling(string propertyId, CancellationToken selectionToken)
    {
        _statusPollingCancellation?.Cancel();
        _statusPollingCancellation?.Dispose();
        _statusPollingCancellation =
            CancellationTokenSource.CreateLinkedTokenSource(selectionToken, _lifetime.Token);
        _ = PollStatusAsync(propertyId, _statusPollingCancellation.Token);
    }

    private async Task PollStatusAsync(string propertyId, CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15));
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken))
            {
                var statuses = await _session.Client.GetBuildingDeviceStatusAsync(
                    _session.Token,
                    propertyId,
                    cancellationToken);
                ApplyDeviceData(
                    Devices.Select(static item => item.Device).ToList(),
                    statuses);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or JsonException)
        {
            BimLog.OperationFailed(_logger, failure.Message);
            OperationError = "Live device health updates paused. Existing status data is still shown.";
        }
    }

    /// <summary>
    /// Applies the entered map anchor. An existing georeference keeps its model-frame anchor
    /// point and unit scale (only the coordinates and rotation change); a first-time anchor
    /// pins the loaded scene's footprint centre to the entered coordinates.
    /// </summary>
    [RelayCommand]
    private async Task ApplyGeoreferenceAsync()
    {
        if (!CanEditGeoreference || SelectedBuilding is not { } building || Model is not { } model)
        {
            return;
        }

        OperationError = null;
        if (!TryParseCoordinate(GeoreferenceLatitudeInput, -90, 90, out var latitude)
            || !TryParseCoordinate(GeoreferenceLongitudeInput, -180, 180, out var longitude))
        {
            OperationError = "Enter the building's latitude (-90 to 90) and longitude (-180 to 180).";
            return;
        }

        double rotation = 0;
        if (GeoreferenceRotationInput.Trim().Length > 0
            && !TryParseCoordinate(GeoreferenceRotationInput, -360, 360, out rotation))
        {
            OperationError = "True north rotation must be between -360 and 360 degrees.";
            return;
        }

        ModelGeoreferenceSummary request;
        if (model.Georeference is { } existing)
        {
            request = existing with
            {
                AnchorLatitude = latitude,
                AnchorLongitude = longitude,
                RotationDegrees = rotation,
            };
        }
        else if (Scene is { } scene && !scene.Bounds.IsEmpty)
        {
            var center = scene.Bounds.Center;
            request = new ModelGeoreferenceSummary(
                latitude, longitude, center.X, center.Y, rotation, 1.0 / scene.Meter);
        }
        else
        {
            OperationError = "Load the model geometry before anchoring it on the map.";
            return;
        }

        await SaveGeoreferenceAsync(building.Id, request);
    }

    /// <summary>Clears the anchor; already-derived pins keep their last position.</summary>
    [RelayCommand]
    private async Task ClearGeoreferenceAsync()
    {
        if (!CanEditGeoreference || SelectedBuilding is not { } building || Model?.Georeference is null)
        {
            return;
        }

        OperationError = null;
        await SaveGeoreferenceAsync(building.Id, null);
    }

    private async Task SaveGeoreferenceAsync(string buildingId, ModelGeoreferenceSummary? request)
    {
        IsSavingGeoreference = true;
        try
        {
            Model = await _session.Client.SetModelGeoreferenceAsync(
                _session.Token, buildingId, request, _lifetime.Token);
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or JsonException)
        {
            SetOperationFailure("The map anchor could not be saved.", failure);
        }
        finally
        {
            IsSavingGeoreference = false;
        }
    }

    private static bool TryParseCoordinate(string input, double minimum, double maximum, out double value) =>
        double.TryParse(input.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out value)
        && double.IsFinite(value)
        && value >= minimum
        && value <= maximum;

    private async Task UpdateDevicePositionAsync(
        BimDeviceItem original,
        double? x,
        double? y,
        double? z)
    {
        if (!CanConfigure)
        {
            OperationError = "Only organization owners and administrators can place devices.";
            return;
        }

        var optimistic = original.Device with
        {
            X = x,
            Y = y,
            Z = z,
        };
        ReplaceDevice(optimistic);
        try
        {
            var saved = await _session.Client.SetDevicePositionAsync(
                _session.Token,
                original.Id,
                x,
                y,
                z,
                _lifetime.Token);
            ReplaceDevice(saved);
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or JsonException)
        {
            RollBackDevicePosition(original);
            SetOperationFailure("The device position could not be saved.", failure);
        }
    }

    private async Task UpdateDeviceLinkAsync(BimDeviceItem original, string? globalId)
    {
        if (!CanConfigure)
        {
            OperationError = "Only organization owners and administrators can link devices.";
            return;
        }

        var optimistic = original.Device with { IfcGlobalId = globalId };
        ReplaceDevice(optimistic);
        try
        {
            var saved = await _session.Client.SetDeviceIfcLinkAsync(
                _session.Token,
                original.Id,
                globalId,
                _lifetime.Token);
            ReplaceDevice(saved);
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or JsonException)
        {
            RollBackDeviceLink(original);
            SetOperationFailure("The IFC link could not be saved.", failure);
        }
    }

    private void ReplaceDevice(BimDevice updated)
    {
        var selectedId = SelectedDevice?.Id;
        _telemetryChangesEnabled = false;
        Devices =
        [
            .. Devices.Select(item =>
                string.Equals(item.Id, updated.Id, StringComparison.Ordinal)
                    ? item with { Device = updated }
                    : item),
        ];
        SelectedDevice = selectedId is null
            ? null
            : Devices.FirstOrDefault(item =>
                string.Equals(item.Id, selectedId, StringComparison.Ordinal));
        _telemetryChangesEnabled = true;
        RefreshRenderOptions();
    }

    private void RollBackDevicePosition(BimDeviceItem original)
    {
        var current = Devices.FirstOrDefault(device =>
            string.Equals(device.Id, original.Id, StringComparison.Ordinal));
        if (current is null)
        {
            return;
        }

        ReplaceDevice(current.Device with
        {
            X = original.Device.X,
            Y = original.Device.Y,
            Z = original.Device.Z,
        });
    }

    private void RollBackDeviceLink(BimDeviceItem original)
    {
        var current = Devices.FirstOrDefault(device =>
            string.Equals(device.Id, original.Id, StringComparison.Ordinal));
        if (current is null)
        {
            return;
        }

        ReplaceDevice(current.Device with { IfcGlobalId = original.Device.IfcGlobalId });
    }

    private async Task LoadTelemetryAsync(BimDeviceItem? selected)
    {
        var current = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
        var previous = Interlocked.Exchange(ref _telemetryCancellation, current);
        if (previous is not null)
        {
            await previous.CancelAsync();
            previous.Dispose();
        }

        if (_metricCancellation is not null)
        {
            await _metricCancellation.CancelAsync();
        }

        MetricNames = [];
        MetricSeries = null;
        StatusEvents = [];
        if (selected is null || current.IsCancellationRequested)
        {
            return;
        }

        try
        {
            var namesTask = _session.Client.GetDeviceMetricNamesAsync(
                _session.Token,
                selected.Id,
                current.Token);
            var eventsTask = _session.Client.GetDeviceStatusEventsAsync(
                _session.Token,
                selected.Id,
                current.Token);
            var names = await namesTask;
            var events = await eventsTask;
            current.Token.ThrowIfCancellationRequested();
            _telemetryChangesEnabled = false;
            MetricNames =
            [
                .. names.Order(
                    StringComparer.CurrentCultureIgnoreCase),
            ];
            SelectedMetricName = MetricNames.Count == 0 ? null : MetricNames[0];
            StatusEvents =
            [
                .. events.Select(static item => new BimStatusEventItem(item)),
            ];
            _telemetryChangesEnabled = true;
            if (SelectedMetricName is { } metric)
            {
                CurrentMetricLoad = LoadMetricAsync(metric);
                await CurrentMetricLoad;
            }
        }
        catch (OperationCanceledException) when (current.IsCancellationRequested)
        {
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or JsonException)
        {
            SetOperationFailure("Device telemetry is temporarily unavailable.", failure);
        }
        finally
        {
            _telemetryChangesEnabled = true;
        }
    }

    private async Task LoadMetricAsync(string? metric)
    {
        if (_metricCancellation is not null)
        {
            await _metricCancellation.CancelAsync();
        }

        _metricCancellation?.Dispose();
        if (SelectedDevice is null || string.IsNullOrWhiteSpace(metric))
        {
            MetricSeries = null;
            return;
        }

        _metricCancellation = CancellationTokenSource.CreateLinkedTokenSource(
            _lifetime.Token,
            _telemetryCancellation?.Token ?? CancellationToken.None);
        var cancellationToken = _metricCancellation.Token;
        var deviceId = SelectedDevice.Id;
        try
        {
            await LoadMetricOnceAsync(deviceId, metric, cancellationToken);
            _ = PollMetricAsync(deviceId, metric, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or JsonException)
        {
            SetOperationFailure($"The {metric} series could not be loaded.", failure);
        }
    }

    private async Task PollMetricAsync(
        string deviceId,
        string metric,
        CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken))
            {
                await LoadMetricOnceAsync(deviceId, metric, cancellationToken);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or JsonException)
        {
            BimLog.OperationFailed(_logger, failure.Message);
        }
    }

    private async Task LoadMetricOnceAsync(
        string deviceId,
        string metric,
        CancellationToken cancellationToken)
    {
        var to = DateTime.UtcNow;
        var from = to.AddHours(-2);
        var points = await _session.Client.GetDeviceMetricsAsync(
            _session.Token,
            deviceId,
            metric,
            from,
            to,
            cancellationToken);
        cancellationToken.ThrowIfCancellationRequested();
        MetricSeries = new BimMetricSeries(
            metric,
            [.. points.OrderBy(static point => point.Bucket)]);
    }

    private async Task ApplyBcfTopicAsync(string topicId)
    {
        OperationError = null;
        try
        {
            var topic = await _session.Client.GetBcfTopicAsync(
                _session.Token,
                topicId,
                _lifetime.Token);
            var viewpoint = topic.Viewpoints.FirstOrDefault(static item => item.IsPrimary)
                ?? (topic.Viewpoints.Count == 0 ? null : topic.Viewpoints[0]);
            if (viewpoint is null)
            {
                OperationError = "This issue has no saved viewpoint.";
                return;
            }

            ApplyBcfComponents(viewpoint.Components);
            var position = ReadVector(viewpoint.Camera.Position);
            var direction = ReadVector(viewpoint.Camera.Direction);
            var up = ReadVector(viewpoint.Camera.Up);
            Camera.SetView(
                position,
                direction,
                up,
                viewpoint.Camera.FieldOfView is { } field
                    ? (float)field
                    : null);
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or JsonException)
        {
            SetOperationFailure("The saved issue viewpoint could not be opened.", failure);
        }
    }

    private BcfComponents CaptureBcfComponents()
    {
        var selection = new List<string>();
        if (SelectedProduct?.GlobalId is { } productGlobalId)
        {
            selection.Add(productGlobalId);
        }

        if (SelectedDevice is { } selectedDevice)
        {
            var deviceGlobalId = IfcGlobalId.Of(selectedDevice.Id);
            if (!selection.Contains(deviceGlobalId, StringComparer.Ordinal))
            {
                selection.Add(deviceGlobalId);
            }
        }

        if (_isolatedProductLabel is { } isolated
            && Scene?.Products.GetValueOrDefault(isolated)?.GlobalId is { } isolatedGlobalId)
        {
            return new BcfComponents(
                selection,
                new BcfVisibility(false, [isolatedGlobalId]));
        }

        var hidden = RenderOptions.HiddenProductLabels
            .Select(label => Scene?.Products.GetValueOrDefault(label)?.GlobalId)
            .Where(static globalId => globalId is not null)
            .Cast<string>()
            .Distinct(StringComparer.Ordinal)
            .ToList();
        return new BcfComponents(
            selection,
            new BcfVisibility(true, hidden));
    }

    private void ApplyBcfComponents(BcfComponents components)
    {
        if (Scene is null)
        {
            return;
        }

        var labelsByGlobalId = Scene.Products.Values
            .Where(static product => product.GlobalId is not null)
            .ToDictionary(
                static product => product.GlobalId!,
                static product => product.Label,
                StringComparer.Ordinal);
        var exceptions = components.Visibility.Exceptions
            .Where(labelsByGlobalId.ContainsKey)
            .Select(globalId => labelsByGlobalId[globalId])
            .ToHashSet();

        Categories =
        [
            .. Categories.Select(static category => category with { IsVisible = true }),
        ];
        if (components.Visibility.DefaultVisibility)
        {
            _isolatedProductLabel = null;
            _explicitlyHiddenProductLabels = exceptions;
        }
        else if (exceptions.Count == 1)
        {
            _explicitlyHiddenProductLabels = [];
            _isolatedProductLabel = exceptions.Single();
        }
        else
        {
            _isolatedProductLabel = null;
            _explicitlyHiddenProductLabels =
            [
                .. Scene.Products.Keys.Where(label => !exceptions.Contains(label)),
            ];
        }

        var selectedLabel = components.Selection
            .Where(labelsByGlobalId.ContainsKey)
            .Select(globalId => (int?)labelsByGlobalId[globalId])
            .FirstOrDefault();
        var devicesByGlobalId = Devices.ToDictionary(
            static device => IfcGlobalId.Of(device.Id),
            StringComparer.Ordinal);
        var selectedDevice = components.Selection
            .Where(devicesByGlobalId.ContainsKey)
            .Select(globalId => devicesByGlobalId[globalId])
            .FirstOrDefault();
        if (selectedDevice is not null)
        {
            SelectedProduct = null;
            SelectedDevice = selectedDevice;
        }
        else
        {
            SelectedDevice = null;
            SelectedProduct = selectedLabel is { } label
                ? Scene.Products.GetValueOrDefault(label)
                : null;
        }

        RefreshRenderOptions();
    }

    private void RefreshRenderOptions()
    {
        if (Scene is null)
        {
            RenderOptions = BimRenderOptions.Empty;
            return;
        }

        var hiddenCategories = Categories
            .Where(static category => !category.IsVisible)
            .Select(static category => category.Name)
            .ToHashSet(StringComparer.Ordinal);
        var hiddenLabels = new HashSet<int>(_explicitlyHiddenProductLabels);
        foreach (var product in Scene.Products.Values)
        {
            if (hiddenCategories.Contains(CategoryName(product)))
            {
                hiddenLabels.Add(product.Label);
            }
        }

        RenderOptions = new BimRenderOptions(
            hiddenLabels,
            _isolatedProductLabel,
            SelectedProduct?.Label,
            SelectedDevice?.Id,
            new BimSectionPlane(
                SectionEnabled,
                SectionAxis,
                SectionConstant),
            [
                .. FilteredDevices()
                    .Where(static device => device.IsPlaced)
                    .Select(ToVisual),
            ]);
    }

    private float SectionConstant
    {
        get
        {
            if (Scene is null)
            {
                return 0f;
            }

            var minimum = Coordinate(Scene.Bounds.Min, SectionAxis);
            var maximum = Coordinate(Scene.Bounds.Max, SectionAxis);
            return minimum
                + ((maximum - minimum)
                    * (float)Math.Clamp(SectionPosition, 0d, 100d)
                    / 100f);
        }
    }

    private IEnumerable<BimDeviceItem> FilteredDevices()
    {
        var floor = SelectedFloor?.Floor;
        return floor is null
            ? Devices
            : Devices.Where(device => device.Floor == floor);
    }

    private void NotifyDeviceSummaryChanged()
    {
        OnPropertyChanged(nameof(UpCount));
        OnPropertyChanged(nameof(DownCount));
        OnPropertyChanged(nameof(WarningCount));
        OnPropertyChanged(nameof(UnknownCount));
        OnPropertyChanged(nameof(PlacedDeviceCount));
        OnPropertyChanged(nameof(HealthDevices));
    }

    private void SetOperationFailure(string message, Exception failure)
    {
        BimLog.OperationFailed(_logger, failure.Message);
        OperationError = message;
    }

    private static BimScene EnrichScene(
        BimScene scene,
        IReadOnlyList<BuildingModelElementMetadata> metadata)
    {
        var byLabel = metadata.ToDictionary(static element => element.ProductLabel);
        var products = scene.Products.ToDictionary(
            static pair => pair.Key,
            pair => byLabel.TryGetValue(pair.Key, out var element)
                ? pair.Value with
                {
                    GlobalId = element.GlobalId,
                    TypeName = element.TypeName,
                    Name = element.Name,
                }
                : pair.Value);
        return scene with { Products = products };
    }

    private static string CategoryName(BimProduct product) =>
        product.TypeName ?? $"IFC type {product.Type}";

    private static BimDeviceVisual ToVisual(BimDeviceItem device) => new(
        device.Id,
        device.Name,
        device.Category,
        new Vector3(
            (float)device.Device.X!.Value,
            (float)device.Device.Y!.Value,
            (float)device.Device.Z!.Value),
        device.State,
        device.Floor,
        device.Device.FloorLabel);

    private static IReadOnlyList<double> Coordinates(Vector3 value) =>
        [(double)value.X, value.Y, value.Z];

    private static Vector3 ReadVector(IReadOnlyList<double> values) =>
        values.Count >= 3
            ? new Vector3((float)values[0], (float)values[1], (float)values[2])
            : Vector3.Zero;

    private static float Coordinate(Vector3 value, BimSectionAxis axis) => axis switch
    {
        BimSectionAxis.X => value.X,
        BimSectionAxis.Y => value.Y,
        _ => value.Z,
    };

    private static BcfTopicSummary ToSummary(BcfTopic topic) => new(
        topic.Id,
        topic.PropertyId,
        topic.Guid,
        topic.Title,
        topic.TopicType,
        topic.TopicStatus,
        topic.Priority,
        topic.Version,
        topic.CommentCount);

    private Task SetNoBuildingsAsync()
    {
        ResetOperations();
        Scene = null;
        Model = null;
        State = BimViewerState.NoBuildings;
        return Task.CompletedTask;
    }

    private void SceneFit()
    {
        if (Scene is not null)
        {
            Camera.Fit(Scene.Bounds);
        }
    }

    private void SetLoading()
    {
        ResetOperations();
        Scene = null;
        Model = null;
        ErrorDetails = null;
        State = BimViewerState.Loading;
    }

    private void ResetOperations()
    {
        _statusPollingCancellation?.Cancel();
        _telemetryCancellation?.Cancel();
        _metricCancellation?.Cancel();
        _telemetryChangesEnabled = false;
        Devices = [];
        SelectedDevice = null;
        SelectedProduct = null;
        MetricNames = [];
        SelectedMetricName = null;
        MetricSeries = null;
        StatusEvents = [];
        BcfTopics = [];
        SelectedBcfTopic = null;
        Categories = [];
        FloorOptions = [new BimFloorOption("All floors", null)];
        SelectedFloor = FloorOptions[0];
        HasElementMetadata = false;
        OperationError = null;
        InteractionMode = BimInteractionMode.Select;
        _explicitlyHiddenProductLabels = [];
        _isolatedProductLabel = null;
        _access = new AccessSummary("VIEWER", [], false);
        _telemetryChangesEnabled = true;
        OnPropertyChanged(nameof(CanConfigure));
        OnPropertyChanged(nameof(CanPlaceSelectedDevice));
        OnPropertyChanged(nameof(CanLinkSelectedDevice));
        OnPropertyChanged(nameof(CanClearSelectedDevicePosition));
        OnPropertyChanged(nameof(CanClearSelectedDeviceLink));
        OnPropertyChanged(nameof(CanCreateIssue));
        OnPropertyChanged(nameof(CanEditGeoreference));
        ClearDevicePositionCommand.NotifyCanExecuteChanged();
        ClearDeviceLinkCommand.NotifyCanExecuteChanged();
    }

    private void SetError(Exception failure, string operation)
    {
        BimLog.LoadFailed(_logger, operation, failure.Message);
        ErrorDetails = failure is InvalidDataException
            ? "The appliance returned an invalid wexBIM artifact. Re-import the source IFC."
            : failure.Message;
        State = BimViewerState.Error;
    }

    private async Task DeleteIncompleteVersionAsync(string propertyId, string versionId)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        try
        {
            await _session.Client.DeleteModelVersionAsync(
                _session.Token,
                propertyId,
                versionId,
                timeout.Token);
        }
        catch (Exception failure) when (
            failure is ApplianceApiException
                or HttpRequestException
                or OperationCanceledException)
        {
            BimLog.ImportCleanupFailed(_logger, propertyId, versionId, failure.Message);
        }
    }

    private static string ImportFailureMessage(Exception failure) =>
        failure switch
        {
            ApplianceApiException { Code: "ORG_003" } =>
                "Only organization owners and administrators can import building models.",
            ApplianceApiException { Code: "MODEL_006" } =>
                "The IFC exceeds the appliance's model size limit.",
            ApplianceApiException { Code: "MODEL_007" } =>
                "The selected file is not a valid IFC STEP file.",
            HttpRequestException =>
                "The appliance connection failed during import. No incomplete version was activated.",
            UnauthorizedAccessException =>
                "NodeScope could not read the selected IFC file.",
            _ => failure.Message,
        };
}

/// <summary>Source-generated log messages for the native BIM surface.</summary>
internal static partial class BimLog
{
    [LoggerMessage(Level = LogLevel.Warning,
        Message = "Building {PropertyId} has no wexBIM artifact for its active version")]
    public static partial void GeometryMissing(ILogger logger, string propertyId);

    [LoggerMessage(Level = LogLevel.Information,
        Message = "Building {PropertyId} uses an older model version without an IFC element index")]
    public static partial void MetadataMissing(ILogger logger, string propertyId);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "BIM viewer failed while {Operation}: {Reason}")]
    public static partial void LoadFailed(ILogger logger, string operation, string reason);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "Seeding the georeference for building {PropertyId} failed: {Reason}")]
    public static partial void GeoreferenceSeedFailed(ILogger logger, string propertyId, string reason);

    [LoggerMessage(Level = LogLevel.Information,
        Message = "Imported building {PropertyId} model version {VersionId} with {GeometryBytes} bytes of wexBIM geometry")]
    public static partial void ImportCompleted(
        ILogger logger,
        string propertyId,
        string versionId,
        int geometryBytes);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "IFC import for building {PropertyId} from {FileName} failed: {Reason}")]
    public static partial void ImportFailed(
        ILogger logger,
        string propertyId,
        string fileName,
        string reason);

    [LoggerMessage(Level = LogLevel.Error,
        Message = "Could not remove incomplete building {PropertyId} model version {VersionId}: {Reason}")]
    public static partial void ImportCleanupFailed(
        ILogger logger,
        string propertyId,
        string versionId,
        string reason);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "A BIM operation failed: {Reason}")]
    public static partial void OperationFailed(ILogger logger, string reason);
}
