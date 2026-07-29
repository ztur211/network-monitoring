using System.Collections.ObjectModel;
using System.Globalization;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Extensions.Logging;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Realtime;

namespace NodeScope.Desktop.ViewModels;

[INotifyPropertyChanged]
internal sealed partial class AlertChannelRow(AlertChannel channel)
{
    [ObservableProperty]
    private bool _selected;

    [ObservableProperty]
    private bool _confirmingDelete;

    [ObservableProperty]
    private string? _status;

    public AlertChannel Channel { get; } = channel;

    public string DetailLine => $"{Channel.Type}  ·  {(Channel.Enabled ? "enabled" : "disabled")}";
}

[INotifyPropertyChanged]
internal sealed partial class AlertRuleRow(AlertRule rule)
{
    [ObservableProperty]
    private bool _confirmingDelete;

    public AlertRule Rule { get; } = rule;

    public string DetailLine =>
        $"{Rule.Trigger}  ·  {Rule.Severity}  ·  {ScopeLabel(Rule.Scope)}  ·  "
        + $"{Rule.ChannelIds.Count} channel{(Rule.ChannelIds.Count == 1 ? "" : "s")}";

    private static string ScopeLabel(JsonElement scope)
    {
        if (scope.TryGetProperty("all", out var all) && all.ValueKind == JsonValueKind.True)
        {
            return "all devices";
        }

        if (scope.TryGetProperty("deviceIds", out _))
        {
            return "device scope";
        }

        if (scope.TryGetProperty("networkIds", out _))
        {
            return "network scope";
        }

        return scope.TryGetProperty("siteIds", out _) ? "site scope" : "custom scope";
    }
}

internal sealed record AlertEventRow(AlertEvent Event)
{
    public string Title => Event.RuleName;

    public string DeviceLine => Event.DeviceId is null ? "No device" : $"Device {Event.DeviceId}";

    public string DetailLine
    {
        get
        {
            if (Event.Detail.TryGetProperty("state", out var state)
                && state.GetString() is { } stateValue)
            {
                return $"State {stateValue}";
            }

            if (Event.Detail.TryGetProperty("metric", out var metric)
                && metric.GetString() is { } metricValue
                && Event.Detail.TryGetProperty("value", out var value)
                && value.TryGetDouble(out var number))
            {
                return string.Create(CultureInfo.InvariantCulture, $"{metricValue} {number:0.##}");
            }

            return Event.Kind == "FIRING" ? "Condition entered" : "Condition recovered";
        }
    }

    public string Timestamp =>
        Event.CreatedAt.ToLocalTime().ToString("g", CultureInfo.CurrentCulture);

    public string SeverityColor => Event.Severity switch
    {
        "CRITICAL" => "#dc2626",
        "WARNING" => "#d97706",
        _ => "#2563eb",
    };

    public string KindColor => Event.Kind == "FIRING" ? "#dc2626" : "#16a34a";
}

/// <summary>
/// Admin alert history and configuration. The live feed is capped at 200 items and
/// refetched after reconnect because SignalR does not replay notifications.
/// </summary>
[INotifyPropertyChanged]
internal sealed partial class AlertsViewModel : IDisposable
{
    public static readonly IReadOnlyList<string> ChannelTypes = ["WEBHOOK", "EMAIL", "INAPP"];
    public static readonly IReadOnlyList<string> RuleTriggers = ["STATE_TRANSITION", "METRIC_THRESHOLD"];
    public static readonly IReadOnlyList<string> Severities = ["INFO", "WARNING", "CRITICAL"];
    public static readonly IReadOnlyList<string> ScopeKinds = ["All devices", "Device IDs", "Network IDs", "Site IDs"];
    public static readonly IReadOnlyList<string> Operators = ["gt", "lt"];

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly ApplianceSession _session;
    private readonly ILogger _logger;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly IDisposable _firedSubscription;
    private readonly IDisposable _resolvedSubscription;
    private readonly IDisposable _reconnectedSubscription;

    [ObservableProperty]
    private bool _isLoading = true;

    [ObservableProperty]
    private bool _isBusy;

    [ObservableProperty]
    private bool _canManage;

    [ObservableProperty]
    private string? _error;

    [ObservableProperty]
    private string? _status;

    [ObservableProperty]
    private string _channelType = "WEBHOOK";

    [ObservableProperty]
    private string _channelName = "";

    [ObservableProperty]
    private string _webhookUrl = "";

    [ObservableProperty]
    private string _channelSecret = "";

    [ObservableProperty]
    private string _emailHost = "";

    [ObservableProperty]
    private string _emailPort = "587";

    [ObservableProperty]
    private string _emailFrom = "";

    [ObservableProperty]
    private string _emailRecipients = "";

    [ObservableProperty]
    private string _emailUsername = "";

    [ObservableProperty]
    private string _ruleName = "";

    [ObservableProperty]
    private string _ruleTrigger = "STATE_TRANSITION";

    [ObservableProperty]
    private string _ruleSeverity = "WARNING";

    [ObservableProperty]
    private string _scopeKind = "All devices";

    [ObservableProperty]
    private string _scopeIds = "";

    [ObservableProperty]
    private bool _targetDown = true;

    [ObservableProperty]
    private bool _targetWarning;

    [ObservableProperty]
    private string _metricOperator = "gt";

    [ObservableProperty]
    private string _metricThreshold = "500";

    [ObservableProperty]
    private string _forSeconds = "60";

    [ObservableProperty]
    private string _cooldownSeconds = "60";

    [ObservableProperty]
    private bool _notifyOnRecovery = true;

    public AlertsViewModel(
        ApplianceSession session,
        IRealtimeConnection realtime,
        ILogger<AlertsViewModel> logger)
    {
        _session = session;
        _logger = logger;
        _firedSubscription = realtime.OnAlertFired(alert => AddLive(alert, "FIRING"));
        _resolvedSubscription = realtime.OnAlertResolved(alert => AddLive(alert, "RESOLVED"));
        _reconnectedSubscription = realtime.OnReconnected(() => _ = LoadAsync());
        Initialization = LoadAsync();
    }

    internal Task Initialization { get; }

    public ObservableCollection<AlertEventRow> Events { get; } = [];

    public ObservableCollection<AlertChannelRow> Channels { get; } = [];

    public ObservableCollection<AlertRuleRow> Rules { get; } = [];

    public bool IsWebhook => ChannelType == "WEBHOOK";

    public bool IsEmail => ChannelType == "EMAIL";

    public bool IsInApp => ChannelType == "INAPP";

    public bool IsStateRule => RuleTrigger == "STATE_TRANSITION";

    public bool IsMetricRule => RuleTrigger == "METRIC_THRESHOLD";

    public bool ScopeNeedsIds => ScopeKind != "All devices";

    public bool HasEvents => Events.Count > 0;

    public bool HasChannels => Channels.Count > 0;

    public bool HasRules => Rules.Count > 0;

    public string AccessMessage => CanManage
        ? ""
        : "Alerts are available to organization owners and admins.";

    public void Dispose()
    {
        _firedSubscription.Dispose();
        _resolvedSubscription.Dispose();
        _reconnectedSubscription.Dispose();
        _lifetime.Cancel();
        _lifetime.Dispose();
    }

    [RelayCommand]
    public async Task LoadAsync()
    {
        IsLoading = true;
        Error = null;
        try
        {
            var access = await _session.Client.GetAccessSummaryAsync(
                _session.Token,
                _lifetime.Token);
            CanManage = access.CanConfigure;
            if (!CanManage)
            {
                ClearCollections();
                return;
            }

            var channelsTask = _session.Client.GetAlertChannelsAsync(
                _session.Token,
                _lifetime.Token);
            var rulesTask = _session.Client.GetAlertRulesAsync(
                _session.Token,
                _lifetime.Token);
            var eventsTask = _session.Client.GetAlertEventsAsync(
                _session.Token,
                _lifetime.Token);
            await Task.WhenAll(channelsTask, rulesTask, eventsTask);

            Replace(Channels, (await channelsTask).Select(channel => new AlertChannelRow(channel)));
            Replace(Rules, (await rulesTask).Select(rule => new AlertRuleRow(rule)));
            Replace(Events, (await eventsTask).Select(alertEvent => new AlertEventRow(alertEvent)));
            NotifyCollectionsChanged();
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or TaskCanceledException)
        {
            if (!_lifetime.IsCancellationRequested)
            {
                Error = failure.Message;
                AlertsLog.OperationFailed(_logger, "load", failure);
            }
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private async Task CreateChannelAsync()
    {
        Error = null;
        Status = null;
        var name = ChannelName.Trim();
        if (name.Length == 0)
        {
            Error = "Enter a channel name.";
            return;
        }

        JsonElement config;
        string? secret = string.IsNullOrWhiteSpace(ChannelSecret) ? null : ChannelSecret;
        if (ChannelType == "WEBHOOK")
        {
            if (!Uri.TryCreate(WebhookUrl.Trim(), UriKind.Absolute, out var uri)
                || uri.Scheme is not ("http" or "https"))
            {
                Error = "Enter an absolute HTTP or HTTPS webhook URL.";
                return;
            }

            config = JsonSerializer.SerializeToElement(new { url = uri.ToString() }, Json);
        }
        else if (ChannelType == "EMAIL")
        {
            if (!int.TryParse(EmailPort, NumberStyles.None, CultureInfo.InvariantCulture, out var port)
                || port is < 1 or > 65535)
            {
                Error = "Enter an SMTP port from 1 to 65535.";
                return;
            }

            var recipients = SplitValues(EmailRecipients);
            if (EmailHost.Trim().Length == 0
                || !EmailFrom.Contains('@', StringComparison.Ordinal)
                || recipients.Count == 0
                || recipients.Any(address => !address.Contains('@', StringComparison.Ordinal)))
            {
                Error = "Enter the SMTP host, sender, and at least one recipient.";
                return;
            }

            config = JsonSerializer.SerializeToElement(
                new
                {
                    host = EmailHost.Trim(),
                    port,
                    fromAddr = EmailFrom.Trim(),
                    toAddrs = recipients,
                    username = string.IsNullOrWhiteSpace(EmailUsername) ? null : EmailUsername.Trim(),
                },
                Json);
        }
        else
        {
            config = JsonSerializer.SerializeToElement(new { }, Json);
            secret = null;
        }

        IsBusy = true;
        try
        {
            var created = await _session.Client.CreateAlertChannelAsync(
                _session.Token,
                new CreateAlertChannel(ChannelType, name, true, config, secret),
                _lifetime.Token);
            Channels.Add(new AlertChannelRow(created));
            ChannelName = "";
            ChannelSecret = "";
            WebhookUrl = "";
            Status = $"Channel {created.Name} created.";
            NotifyCollectionsChanged();
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or TaskCanceledException)
        {
            Error = failure.Message;
            AlertsLog.OperationFailed(_logger, "create channel", failure);
        }
        finally
        {
            IsBusy = false;
        }
    }

    [RelayCommand]
    private async Task TestChannelAsync(AlertChannelRow row)
    {
        ArgumentNullException.ThrowIfNull(row);
        Error = null;
        row.Status = "Sending test…";
        try
        {
            await _session.Client.TestAlertChannelAsync(
                _session.Token,
                row.Channel.Id,
                _lifetime.Token);
            row.Status = "Test sent.";
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or TaskCanceledException)
        {
            row.Status = "Test failed.";
            Error = failure.Message;
            AlertsLog.OperationFailed(_logger, "test channel", failure);
        }
    }

    [RelayCommand]
    private async Task DeleteChannelAsync(AlertChannelRow row)
    {
        ArgumentNullException.ThrowIfNull(row);
        if (!row.ConfirmingDelete)
        {
            row.ConfirmingDelete = true;
            return;
        }

        Error = null;
        IsBusy = true;
        try
        {
            await _session.Client.DeleteAlertChannelAsync(
                _session.Token,
                row.Channel.Id,
                _lifetime.Token);
            Channels.Remove(row);
            NotifyCollectionsChanged();
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or TaskCanceledException)
        {
            row.ConfirmingDelete = false;
            Error = failure is ApplianceApiException { Code: "ALERT_002" }
                ? "Delete the rules that use this channel first."
                : failure.Message;
            AlertsLog.OperationFailed(_logger, "delete channel", failure);
        }
        finally
        {
            IsBusy = false;
        }
    }

    [RelayCommand]
    private async Task CreateRuleAsync()
    {
        Error = null;
        Status = null;
        var name = RuleName.Trim();
        var selectedChannels = Channels
            .Where(channel => channel.Selected)
            .Select(channel => channel.Channel.Id)
            .ToList();
        if (name.Length == 0 || selectedChannels.Count == 0)
        {
            Error = "Enter a rule name and select at least one channel.";
            return;
        }

        if (!int.TryParse(
                CooldownSeconds,
                NumberStyles.None,
                CultureInfo.InvariantCulture,
                out var cooldown)
            || cooldown is < 0 or > 2_592_000)
        {
            Error = "Cooldown must be a whole number from 0 to 2592000.";
            return;
        }

        var scope = BuildScope();
        if (scope is null)
        {
            return;
        }

        IReadOnlyList<string> states = [];
        string? metric = null;
        string? op = null;
        double? threshold = null;
        int? duration = null;
        if (IsStateRule)
        {
            states =
            [
                .. new[]
                {
                    TargetDown ? "DOWN" : null,
                    TargetWarning ? "WARNING" : null,
                }.OfType<string>(),
            ];
            if (states.Count == 0)
            {
                Error = "Select DOWN, WARNING, or both.";
                return;
            }
        }
        else
        {
            if (!double.TryParse(
                    MetricThreshold,
                    NumberStyles.Float,
                    CultureInfo.InvariantCulture,
                    out var parsedThreshold)
                || !double.IsFinite(parsedThreshold)
                || parsedThreshold is < 0 or > 600_000
                || !int.TryParse(ForSeconds, NumberStyles.None, CultureInfo.InvariantCulture, out var parsedDuration)
                || parsedDuration is < 1 or > 86_400)
            {
                Error = "Enter a latency from 0 to 600000 ms and a duration from 1 to 86400 seconds.";
                return;
            }

            metric = "latencyMs";
            op = MetricOperator;
            threshold = parsedThreshold;
            duration = parsedDuration;
        }

        IsBusy = true;
        try
        {
            var created = await _session.Client.CreateAlertRuleAsync(
                _session.Token,
                new CreateAlertRule(
                    name,
                    RuleTrigger,
                    scope.Value,
                    states,
                    metric,
                    op,
                    threshold,
                    duration,
                    RuleSeverity,
                    selectedChannels,
                    cooldown,
                    NotifyOnRecovery),
                _lifetime.Token);
            Rules.Add(new AlertRuleRow(created));
            RuleName = "";
            foreach (var channel in Channels)
            {
                channel.Selected = false;
            }

            Status = $"Rule {created.Name} created.";
            NotifyCollectionsChanged();
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or TaskCanceledException)
        {
            Error = failure.Message;
            AlertsLog.OperationFailed(_logger, "create rule", failure);
        }
        finally
        {
            IsBusy = false;
        }
    }

    [RelayCommand]
    private async Task DeleteRuleAsync(AlertRuleRow row)
    {
        ArgumentNullException.ThrowIfNull(row);
        if (!row.ConfirmingDelete)
        {
            row.ConfirmingDelete = true;
            return;
        }

        Error = null;
        IsBusy = true;
        try
        {
            await _session.Client.DeleteAlertRuleAsync(
                _session.Token,
                row.Rule.Id,
                _lifetime.Token);
            Rules.Remove(row);
            NotifyCollectionsChanged();
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or TaskCanceledException)
        {
            row.ConfirmingDelete = false;
            Error = failure.Message;
            AlertsLog.OperationFailed(_logger, "delete rule", failure);
        }
        finally
        {
            IsBusy = false;
        }
    }

    partial void OnChannelTypeChanged(string value)
    {
        OnPropertyChanged(nameof(IsWebhook));
        OnPropertyChanged(nameof(IsEmail));
        OnPropertyChanged(nameof(IsInApp));
    }

    partial void OnRuleTriggerChanged(string value)
    {
        OnPropertyChanged(nameof(IsStateRule));
        OnPropertyChanged(nameof(IsMetricRule));
    }

    partial void OnScopeKindChanged(string value) =>
        OnPropertyChanged(nameof(ScopeNeedsIds));

    partial void OnCanManageChanged(bool value) =>
        OnPropertyChanged(nameof(AccessMessage));

    private JsonElement? BuildScope()
    {
        if (ScopeKind == "All devices")
        {
            return JsonSerializer.SerializeToElement(new { all = true }, Json);
        }

        var ids = SplitValues(ScopeIds);
        if (ids.Count == 0 || ids.Any(id => !Guid.TryParse(id, out _)))
        {
            Error = "Enter one or more comma-separated UUIDs for the selected scope.";
            return null;
        }

        object selector = ScopeKind switch
        {
            "Device IDs" => new { deviceIds = ids },
            "Network IDs" => new { networkIds = ids },
            _ => new { siteIds = ids },
        };
        return JsonSerializer.SerializeToElement(selector, Json);
    }

    private void AddLive(AlertRealtimeEvent received, string kind)
    {
        if (!CanManage)
        {
            return;
        }

        var alertEvent = new AlertEvent(
            received.Id,
            "",
            received.RuleId,
            received.RuleName,
            received.DeviceId,
            kind,
            received.Severity,
            received.Detail,
            $"{received.RuleId}:{received.DeviceId}",
            received.At);
        Events.Insert(0, new AlertEventRow(alertEvent));
        while (Events.Count > 200)
        {
            Events.RemoveAt(Events.Count - 1);
        }

        NotifyCollectionsChanged();
    }

    private void ClearCollections()
    {
        Channels.Clear();
        Rules.Clear();
        Events.Clear();
        NotifyCollectionsChanged();
    }

    private void NotifyCollectionsChanged()
    {
        OnPropertyChanged(nameof(HasChannels));
        OnPropertyChanged(nameof(HasRules));
        OnPropertyChanged(nameof(HasEvents));
    }

    private static List<string> SplitValues(string value) =>
        [.. value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(candidate => candidate.Length > 0)
            .Distinct(StringComparer.Ordinal)];

    private static void Replace<T>(ObservableCollection<T> collection, IEnumerable<T> values)
    {
        collection.Clear();
        foreach (var value in values)
        {
            collection.Add(value);
        }
    }
}

internal static partial class AlertsLog
{
    [LoggerMessage(Level = LogLevel.Warning, Message = "Alerts {Operation} failed")]
    public static partial void OperationFailed(
        ILogger logger,
        string operation,
        Exception exception);
}
