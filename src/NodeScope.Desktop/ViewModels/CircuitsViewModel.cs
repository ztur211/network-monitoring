using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Extensions.Logging;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Map;
using NodeScope.Desktop.Realtime;

namespace NodeScope.Desktop.ViewModels;

/// <summary>One circuit row, with its two-step delete state.</summary>
[INotifyPropertyChanged]
internal sealed partial class CircuitRow(Circuit circuit)
{
    [ObservableProperty]
    private bool _confirmingDelete;

    public Circuit Circuit { get; } = circuit;

    /// <summary>"1.5 Gbps" at and above 1000 Mbps, "300 Mbps" below (web parity).</summary>
    public string? BandwidthLabel => Circuit.Bandwidth switch
    {
        null => null,
        >= 1000 and var mbps => string.Create(CultureInfo.InvariantCulture, $"{mbps / 1000:0.#} Gbps"),
        var mbps => string.Create(CultureInfo.InvariantCulture, $"{mbps:0.#} Mbps"),
    };
}

/// <summary>
/// The circuits tab: the cursor-paginated list (server page order) with create, edit,
/// and delete. Circuits are org-wide and every member may write - the API has no
/// role or scope gate here, so neither does the UI.
/// </summary>
[INotifyPropertyChanged]
internal sealed partial class CircuitsViewModel : IDisposable
{
    internal const int PageSize = 50;

    private readonly ApplianceSession _session;
    private readonly ILogger _logger;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly List<Circuit> _circuits = [];
    private readonly IDisposable _circuitUpdatedSubscription;
    private readonly IDisposable _circuitDeletedSubscription;
    private readonly IDisposable _reconnectedSubscription;

    private string? _nextCursor;

    [ObservableProperty]
    private bool _isLoading = true;

    [ObservableProperty]
    private bool _isLoadingMore;

    [ObservableProperty]
    private string? _loadError;

    [ObservableProperty]
    private string? _operationError;

    [ObservableProperty]
    private IReadOnlyList<CircuitRow> _rows = [];

    [ObservableProperty]
    private int _total;

    [ObservableProperty]
    private bool _hasMore;

    [ObservableProperty]
    private CircuitFormViewModel? _form;

    public CircuitsViewModel(ApplianceSession session, IRealtimeConnection realtime, ILogger logger)
    {
        _session = session;
        _logger = logger;
        _circuitUpdatedSubscription = realtime.OnCircuitUpdated(OnCircuitUpdated);
        _circuitDeletedSubscription = realtime.OnCircuitDeleted(OnCircuitDeleted);
        // A reconnect refetches from the first page - the server replays nothing across
        // the gap (deliberate deviation: the web accepted the lost deltas).
        _reconnectedSubscription = realtime.OnReconnected(() => _ = LoadAsync());
        Initialization = LoadAsync();
    }

    /// <summary>The initial load; awaited by tests.</summary>
    internal Task Initialization { get; }

    public string TotalLabel => Total == 1 ? "1 circuit" : string.Create(CultureInfo.InvariantCulture, $"{Total} circuits");

    public bool IsListEmpty => Rows.Count == 0 && !IsLoading && LoadError is null;

    public void Dispose()
    {
        _circuitUpdatedSubscription.Dispose();
        _circuitDeletedSubscription.Dispose();
        _reconnectedSubscription.Dispose();
        _lifetime.Cancel();
        _lifetime.Dispose();
    }

    /// <summary>
    /// The pushed circuit wins in place. An unseen id is ignored - creates never emit on
    /// this host, so it is an edit of a row on a page we have not loaded; appending it
    /// (what the web did) would corrupt the server page order and the counters.
    /// </summary>
    private void OnCircuitUpdated(CircuitUpdatedEvent received)
    {
        var index = _circuits.FindIndex(circuit => circuit.Id == received.Circuit.Id);
        if (index < 0)
        {
            return;
        }

        _circuits[index] = received.Circuit;
        RebuildRows();
    }

    /// <summary>
    /// Removes a loaded row and keeps <see cref="Total"/> honest (deliberate deviation:
    /// the web left the counter stale). An unseen id is ignored - it is either the echo
    /// of our own optimistic delete, which already adjusted the counter, or a row on an
    /// unloaded page, where the two cases cannot be told apart.
    /// </summary>
    private void OnCircuitDeleted(CircuitDeletedEvent received)
    {
        if (_circuits.RemoveAll(circuit => circuit.Id == received.CircuitId) == 0)
        {
            return;
        }

        Total = Math.Max(0, Total - 1);
        RebuildRows();
    }

    [RelayCommand]
    public async Task LoadAsync()
    {
        IsLoading = true;
        LoadError = null;
        try
        {
            var page = await _session.Client.GetCircuitsAsync(_session.Token, PageSize, null, _lifetime.Token);
            _circuits.Clear();
            _circuits.AddRange(page.Items);
            _nextCursor = page.NextCursor;
            Total = page.Total;
            HasMore = _nextCursor is not null;
            RebuildRows();
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            LoadError = failure.Message;
            CircuitsLog.LoadFailed(_logger, failure);
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private async Task LoadMoreAsync()
    {
        if (_nextCursor is null || IsLoadingMore)
        {
            return;
        }

        IsLoadingMore = true;
        try
        {
            var page = await _session.Client.GetCircuitsAsync(_session.Token, PageSize, _nextCursor, _lifetime.Token);
            _circuits.AddRange(page.Items);
            _nextCursor = page.NextCursor;
            Total = page.Total;
            HasMore = _nextCursor is not null;
            RebuildRows();
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            OperationError = $"Loading more circuits failed: {failure.Message}";
            CircuitsLog.LoadFailed(_logger, failure);
        }
        finally
        {
            IsLoadingMore = false;
        }
    }

    [RelayCommand]
    private async Task BeginAddAsync()
    {
        var devices = await DeviceOptionsAsync();
        Form = new CircuitFormViewModel(original: null, devices, SubmitCreateAsync, close: () => Form = null);
    }

    [RelayCommand]
    private async Task BeginEditAsync(CircuitRow row)
    {
        var devices = await DeviceOptionsAsync();
        Form = new CircuitFormViewModel(row.Circuit, devices, SubmitEditAsync, close: () => Form = null);
    }

    [RelayCommand]
    private async Task DeleteAsync(CircuitRow row)
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

        var index = _circuits.FindIndex(circuit => circuit.Id == row.Circuit.Id);
        if (index < 0)
        {
            return;
        }

        var removed = _circuits[index];
        _circuits.RemoveAt(index);
        Total -= 1;
        RebuildRows();
        try
        {
            await _session.Client.DeleteCircuitAsync(_session.Token, removed.Id, _lifetime.Token);
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            _circuits.Insert(Math.Min(index, _circuits.Count), removed);
            Total += 1;
            RebuildRows();
            OperationError = $"Deleting the {removed.IspName} circuit failed: {failure.Message}";
            CircuitsLog.MutationFailed(_logger, "delete", failure);
        }
    }

    [RelayCommand]
    private void DismissOperationError() => OperationError = null;

    private async Task<bool> SubmitCreateAsync(CircuitFormViewModel form, CancellationToken cancellationToken)
    {
        try
        {
            var created = await _session.Client.CreateCircuitAsync(
                _session.Token, form.BuildCreate(), cancellationToken);
            _circuits.Insert(0, created);
            Total += 1;
            RebuildRows();
            return true;
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            form.SubmitError = failure.Message;
            CircuitsLog.MutationFailed(_logger, "create", failure);
            return false;
        }
    }

    private async Task<bool> SubmitEditAsync(CircuitFormViewModel form, CancellationToken cancellationToken)
    {
        var changes = form.BuildChanges();
        if (changes.Count == 0)
        {
            return true;
        }

        var original = form.Original!;
        try
        {
            var updated = await _session.Client.UpdateCircuitAsync(
                _session.Token, original.Id, original.Version, changes, cancellationToken);
            var index = _circuits.FindIndex(circuit => circuit.Id == updated.Id);
            if (index >= 0)
            {
                _circuits[index] = updated;
            }

            RebuildRows();
            return true;
        }
        catch (ApplianceApiException failure) when (failure.Code == "SYNC_001")
        {
            form.SubmitError = "Someone else edited this circuit. The list has been refreshed - reopen it to retry.";
            await LoadAsync();
            return false;
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            form.SubmitError = failure.Message;
            CircuitsLog.MutationFailed(_logger, "update", failure);
            return false;
        }
    }

    /// <summary>The device-linkage picker's choices, fetched fresh at form open.</summary>
    private async Task<IReadOnlyList<DeviceOption>> DeviceOptionsAsync()
    {
        try
        {
            var page = await _session.Client.GetDeviceInventoryAsync(_session.Token, _lifetime.Token);
            return
            [
                .. page.Items.Select(device => new DeviceOption(
                    device.Id, $"{device.Name} ({DeviceCategories.Resolve(device.Category).DisplayName})")),
            ];
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            CircuitsLog.LoadFailed(_logger, failure);
            return [];
        }
    }

    private void RebuildRows()
    {
        Rows = [.. _circuits.Select(circuit => new CircuitRow(circuit))];
        OnPropertyChanged(nameof(TotalLabel));
        OnPropertyChanged(nameof(IsListEmpty));
    }
}

internal static partial class CircuitsLog
{
    [LoggerMessage(Level = LogLevel.Warning, Message = "Circuits load failed")]
    public static partial void LoadFailed(ILogger logger, Exception exception);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Circuits {Operation} failed")]
    public static partial void MutationFailed(ILogger logger, string operation, Exception exception);
}
