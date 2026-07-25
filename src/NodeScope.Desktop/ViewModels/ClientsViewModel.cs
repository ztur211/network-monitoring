using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Extensions.Logging;
using NodeScope.Desktop.Api;

namespace NodeScope.Desktop.ViewModels;

/// <summary>
/// The clients tab: the "this device" card (what the appliance knows about the calling
/// client) plus the desktop-agent availability notice. The web version's live speed
/// metrics rode the browser collector over the realtime wire - that loop arrives with
/// the realtime milestone; until then the card shows the last stored reading, if any.
/// </summary>
[INotifyPropertyChanged]
internal sealed partial class ClientsViewModel : IDisposable
{
    private readonly ApplianceSession _session;
    private readonly ILogger _logger;
    private readonly CancellationTokenSource _lifetime = new();

    [ObservableProperty]
    private bool _isLoading = true;

    [ObservableProperty]
    private string? _loadError;

    [ObservableProperty]
    private ClientsSummary? _summary;

    public ClientsViewModel(ApplianceSession session, ILogger logger)
    {
        _session = session;
        _logger = logger;
        Initialization = LoadAsync();
    }

    /// <summary>The initial load; awaited by tests.</summary>
    internal Task Initialization { get; }

    public string? PlatformLine => Summary?.CurrentDevice.Platform ?? "Unknown platform";

    public string? MetricsLine
    {
        get
        {
            if (Summary?.CurrentDevice.Metrics is not { } metrics)
            {
                return "No speed readings yet - live metrics arrive with the realtime milestone.";
            }

            var parts = new List<string>(3);
            if (metrics.BandwidthDown is { } down)
            {
                parts.Add(string.Create(CultureInfo.InvariantCulture, $"↓ {down:0.#} Mbps"));
            }

            if (metrics.BandwidthUp is { } up)
            {
                parts.Add(string.Create(CultureInfo.InvariantCulture, $"↑ {up:0.#} Mbps"));
            }

            if (metrics.Latency is { } latency)
            {
                parts.Add(string.Create(CultureInfo.InvariantCulture, $"{latency:0} ms"));
            }

            return parts.Count > 0 ? string.Join("  ·  ", parts) : "No speed readings yet.";
        }
    }

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
            Summary = await _session.Client.GetClientsAsync(_session.Token, _lifetime.Token);
            OnPropertyChanged(nameof(PlatformLine));
            OnPropertyChanged(nameof(MetricsLine));
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            LoadError = failure.Message;
            ClientsLog.LoadFailed(_logger, failure);
        }
        finally
        {
            IsLoading = false;
        }
    }
}

internal static partial class ClientsLog
{
    [LoggerMessage(Level = LogLevel.Warning, Message = "Clients load failed")]
    public static partial void LoadFailed(ILogger logger, Exception exception);
}
