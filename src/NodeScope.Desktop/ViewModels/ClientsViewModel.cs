using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Extensions.Logging;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Realtime;

namespace NodeScope.Desktop.ViewModels;

/// <summary>
/// The clients tab: the "this device" card (what the appliance knows about the calling
/// client) plus the desktop-agent availability notice. Web parity for the live half:
/// the workstation collector submits over the realtime wire, <c>v1:metrics:update</c>
/// pushes the latest sample back, a fresh push overrides the stored REST snapshot, and
/// a sample older than 90 seconds (three push cycles) renders dimmed as stale. One
/// honest improvement over the web: staleness re-evaluates on its own clock instead of
/// waiting for the next render.
/// </summary>
[INotifyPropertyChanged]
internal sealed partial class ClientsViewModel : IDisposable
{
    /// <summary>Web parity: three 30s push cycles without a sample means stale.</summary>
    internal static readonly TimeSpan StaleThreshold = TimeSpan.FromSeconds(90);

    private readonly ApplianceSession _session;
    private readonly ILogger _logger;
    private readonly TimeProvider _time;
    private readonly IDisposable _metricsSubscription;
    private readonly IDisposable _reconnectedSubscription;
    private readonly CancellationTokenSource _lifetime = new();
    private CancellationTokenSource? _staleCheck;

    [ObservableProperty]
    private bool _isLoading = true;

    [ObservableProperty]
    private string? _loadError;

    [ObservableProperty]
    private ClientsSummary? _summary;

    /// <summary>The last pushed sample; null until the first <c>v1:metrics:update</c>.</summary>
    [ObservableProperty]
    private ClientMetrics? _liveMetrics;

    public ClientsViewModel(
        ApplianceSession session, IRealtimeConnection realtime, ILogger logger, TimeProvider? time = null)
    {
        _session = session;
        _logger = logger;
        _time = time ?? TimeProvider.System;
        _metricsSubscription = realtime.OnMetricsUpdate(OnMetricsUpdate);
        _reconnectedSubscription = realtime.OnReconnected(() => _ = LoadAsync());
        Initialization = LoadAsync();
    }

    /// <summary>The initial load; awaited by tests.</summary>
    internal Task Initialization { get; }

    public string? PlatformLine => Summary?.CurrentDevice.Platform ?? "Unknown platform";

    /// <summary>Web parity: the live push wins over the REST snapshot's stored reading.</summary>
    public ClientMetrics? EffectiveMetrics => LiveMetrics ?? Summary?.CurrentDevice.Metrics;

    /// <summary>Web parity: the neutral live-data dot - only a fresh push counts.</summary>
    public bool IsLive => LiveMetrics is not null && !IsStale;

    /// <summary>Web parity: stale until the first push, and again 90s after the last one.</summary>
    public bool IsStale => LiveMetrics is not { } live
        || _time.GetUtcNow() - live.Timestamp > StaleThreshold;

    /// <summary>The web's StaleDataOverlay dimming, as a bindable opacity.</summary>
    public double CardOpacity => IsStale ? 0.45 : 1.0;

    public string? MetricsLine
    {
        get
        {
            if (EffectiveMetrics is not { } metrics)
            {
                return "No live metrics yet - data updates every 30 seconds.";
            }

            var parts = new List<string>(4);
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

            if (metrics.ConnectionQuality is { Length: > 0 } quality)
            {
                parts.Add(quality.ToUpperInvariant());
            }

            return parts.Count > 0 ? string.Join("  ·  ", parts) : "No speed readings yet.";
        }
    }

    /// <summary>When the shown reading was taken, in the local clock.</summary>
    public string? UpdatedLine => EffectiveMetrics is { } metrics
        ? string.Create(
            CultureInfo.InvariantCulture,
            $"Updated {TimeZoneInfo.ConvertTime(new DateTimeOffset(metrics.Timestamp, TimeSpan.Zero), _time.LocalTimeZone):HH:mm:ss}")
        : null;

    public void Dispose()
    {
        _metricsSubscription.Dispose();
        _reconnectedSubscription.Dispose();
        _staleCheck?.Dispose();
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

    private void OnMetricsUpdate(MetricsUpdateEvent received)
    {
        LiveMetrics = received.Metrics;
        ScheduleStaleCheck();
    }

    /// <summary>
    /// Re-evaluates freshness just past the threshold, so the dot goes out and the card
    /// dims when pushes stop, not when something else happens to redraw.
    /// </summary>
    private void ScheduleStaleCheck()
    {
        _staleCheck?.Cancel();
        _staleCheck?.Dispose();
        _staleCheck = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
        _ = NotifyWhenStaleAsync(_staleCheck.Token);
    }

    private async Task NotifyWhenStaleAsync(CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(StaleThreshold + TimeSpan.FromSeconds(1), _time, cancellationToken);
        }
        catch (TaskCanceledException)
        {
            return; // superseded by a newer push, which rescheduled the check
        }

        NotifyMetricsState();
    }

    partial void OnSummaryChanged(ClientsSummary? value)
    {
        OnPropertyChanged(nameof(PlatformLine));
        NotifyMetricsState();
    }

    partial void OnLiveMetricsChanged(ClientMetrics? value) => NotifyMetricsState();

    private void NotifyMetricsState()
    {
        OnPropertyChanged(nameof(EffectiveMetrics));
        OnPropertyChanged(nameof(MetricsLine));
        OnPropertyChanged(nameof(UpdatedLine));
        OnPropertyChanged(nameof(IsLive));
        OnPropertyChanged(nameof(IsStale));
        OnPropertyChanged(nameof(CardOpacity));
    }
}

internal static partial class ClientsLog
{
    [LoggerMessage(Level = LogLevel.Warning, Message = "Clients load failed")]
    public static partial void LoadFailed(ILogger logger, Exception exception);
}
