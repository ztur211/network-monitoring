using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Extensions.Logging;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Map;
using NodeScope.Desktop.Realtime;

namespace NodeScope.Desktop.ViewModels;

/// <summary>The operator's sent line of the chat transcript.</summary>
internal sealed record UserChatEntry(string Content, DateTimeOffset Timestamp);

/// <summary>The inventory device whose live context accompanies assistant messages.</summary>
internal sealed record FocusedAssistantDevice(string Id, string Name, string Category);

/// <summary>
/// An assistant answer: streams token by token, then the complete event finalizes it
/// with the verbatim content and its metadata.
/// </summary>
[INotifyPropertyChanged]
internal sealed partial class AssistantChatEntry(DateTimeOffset timestamp)
{
    [ObservableProperty]
    private string _content = "";

    [ObservableProperty]
    private bool _isStreaming = true;

    [ObservableProperty]
    private string? _usageWarning;

    /// <summary>True renders the amber "network summary only" framing around the answer.</summary>
    [ObservableProperty]
    private bool _providerUnavailable;

    public DateTimeOffset Timestamp { get; } = timestamp;
}

/// <summary>
/// The assistant section: web parity for the chat-only AI surface. The question rides the
/// realtime wire (<c>v1:ai:message</c>), the answer streams back to the whole user group
/// as tokens then a completion; HTTP only serves the quota read and the conversation
/// delete. The transcript is client-local - the server remembers the conversation, not
/// the rendering.
/// </summary>
[INotifyPropertyChanged]
internal sealed partial class AssistantViewModel : IDisposable
{

    /// <summary>The hub silently drops longer messages, so the client refuses them loudly.</summary>
    private const int MaxMessageLength = 2000;

    private readonly ApplianceSession _session;
    private readonly IRealtimeConnection _realtime;
    private readonly ILogger _logger;
    private readonly TimeProvider _time;
    private readonly IDisposable _tokenSubscription;
    private readonly IDisposable _completeSubscription;
    private readonly IDisposable _errorSubscription;
    private readonly CancellationTokenSource _lifetime = new();
    private string? _conversationId;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SendCommand))]
    private string _input = "";

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SendCommand))]
    private bool _isStreaming;

    [ObservableProperty]
    private string? _error;

    [ObservableProperty]
    private AiUsage? _usage;

    [ObservableProperty]
    private bool _isLoadingUsage;

    /// <summary>False after a completion reported the provider unavailable.</summary>
    [ObservableProperty]
    private bool _providerAvailable = true;

    [ObservableProperty]
    private FocusedAssistantDevice? _focusedDevice;

    public AssistantViewModel(
        ApplianceSession session,
        IRealtimeConnection realtime,
        ILogger logger,
        TimeProvider? time = null)
    {
        _session = session;
        _realtime = realtime;
        _logger = logger;
        _time = time ?? TimeProvider.System;
        _tokenSubscription = realtime.OnAiToken(OnAiToken);
        _completeSubscription = realtime.OnAiComplete(OnAiComplete);
        _errorSubscription = realtime.OnError(OnRealtimeError);
        Transcript.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasMessages));
        Initialization = LoadUsageAsync();
    }

    /// <summary>The opening usage read; awaited by tests.</summary>
    internal Task Initialization { get; }

    public ObservableCollection<object> Transcript { get; } = [];

    /// <summary>Web parity: the four starter prompts shown over an empty transcript.</summary>
    public IReadOnlyList<string> Suggestions { get; } =
    [
        "Is my network healthy?",
        "What devices do I have?",
        "Help me troubleshoot a connection issue",
        "What is a fiber run?",
    ];

    public bool HasMessages => Transcript.Count > 0;

    /// <summary>Web parity: input locks once either message counter hits its limit.</summary>
    public bool IsLimitReached =>
        Usage is { } usage
        && (usage.HourlyUsed >= usage.HourlyLimit || usage.DailyUsed >= usage.DailyLimit);

    public string InputPlaceholder =>
        IsLimitReached
            ? "Message limit reached"
            : FocusedDevice is { } device
                ? $"Ask about {device.Name}…"
                : "Ask about your network…";

    public string? UsageSummary => Usage is { } usage
        ? $"{usage.HourlyUsed}/{usage.HourlyLimit} messages this hour"
        : IsLoadingUsage ? "Loading usage…" : null;

    /// <summary>The status banner over the transcript, worst condition first like the web.</summary>
    public string? BannerText
    {
        get
        {
            if (!ProviderAvailable)
            {
                return "AI service temporarily unavailable - responses use your documented network data only";
            }

            if (Usage is not { } usage)
            {
                return null;
            }

            if (usage.HourlyLimit > 0 && usage.HourlyUsed >= usage.HourlyLimit)
            {
                return $"Hourly message limit reached ({usage.HourlyUsed}/{usage.HourlyLimit}). Resets next hour.";
            }

            if (usage.DailyLimit > 0 && usage.DailyUsed >= usage.DailyLimit)
            {
                return $"Daily message limit reached ({usage.DailyUsed}/{usage.DailyLimit}). Resets at midnight.";
            }

            if (usage.HourlyLimit > 0 && usage.HourlyUsed >= usage.HourlyLimit * 0.8)
            {
                return $"{usage.HourlyUsed}/{usage.HourlyLimit} messages used this hour";
            }

            if (usage.DailyLimit > 0 && usage.DailyUsed >= usage.DailyLimit * 0.8)
            {
                return $"{usage.DailyUsed}/{usage.DailyLimit} messages used today";
            }

            return null;
        }
    }

    /// <summary>A hard stop: a limit is exhausted (red).</summary>
    public bool BannerIsAlert => ProviderAvailable && IsLimitReached;

    /// <summary>An early warning: 80% of a limit is spent (yellow).</summary>
    public bool BannerIsCaution => ProviderAvailable && !IsLimitReached && BannerText is not null;

    public void Dispose()
    {
        _tokenSubscription.Dispose();
        _completeSubscription.Dispose();
        _errorSubscription.Dispose();
        _lifetime.Cancel();
        _lifetime.Dispose();
    }

    public bool CanSend => !IsStreaming && !IsLimitReached && Input.Trim().Length > 0;

    /// <summary>Web parity: typing locks while an answer streams or a limit is exhausted.</summary>
    public bool CanType => !IsStreaming && !IsLimitReached;

    [RelayCommand(CanExecute = nameof(CanSend))]
    private async Task SendAsync()
    {
        var content = Input.Trim();
        if (content.Length == 0 || IsStreaming || IsLimitReached)
        {
            return;
        }

        if (content.Length > MaxMessageLength)
        {
            Error = $"Messages are limited to {MaxMessageLength} characters.";
            return;
        }

        Input = "";
        Transcript.Add(new UserChatEntry(content, _time.GetLocalNow()));
        await StreamAnswerAsync(content);
    }

    /// <summary>A starter prompt sends as-is, like tapping a suggestion card on the web.</summary>
    [RelayCommand]
    private async Task AskSuggestionAsync(string prompt)
    {
        if (IsStreaming || IsLimitReached)
        {
            return;
        }

        Transcript.Add(new UserChatEntry(prompt, _time.GetLocalNow()));
        await StreamAnswerAsync(prompt);
    }

    /// <summary>Web parity: re-sends the last user message after a failure.</summary>
    [RelayCommand]
    private async Task RetryAsync()
    {
        if (IsStreaming)
        {
            return;
        }

        var lastUser = Transcript.OfType<UserChatEntry>().LastOrDefault();
        if (lastUser is null)
        {
            return;
        }

        RemoveUnstartedAnswers();
        await StreamAnswerAsync(lastUser.Content);
    }

    /// <summary>Forgets the conversation server-side (best effort) and clears the view.</summary>
    [RelayCommand]
    private async Task ClearConversationAsync()
    {
        if (IsStreaming)
        {
            return;
        }

        await ForgetConversationAsync();
        Transcript.Clear();
        Error = null;
    }

    /// <summary>Starts a fresh, device-scoped troubleshooting exchange from Inventory.</summary>
    public async Task FocusDeviceAsync(BimDevice device)
    {
        ArgumentNullException.ThrowIfNull(device);
        if (IsStreaming || IsLimitReached)
        {
            return;
        }

        await ForgetConversationAsync();
        Transcript.Clear();
        Error = null;
        FocusedDevice = new FocusedAssistantDevice(
            device.Id,
            device.Name,
            DeviceCategories.Resolve(device.Category).DisplayName);
        var prompt = $"Troubleshoot {device.Name}. Summarize its current status, recent telemetry, and documented connections.";
        Transcript.Add(new UserChatEntry(prompt, _time.GetLocalNow()));
        await StreamAnswerAsync(prompt);
    }

    [RelayCommand]
    private async Task ClearFocusAsync()
    {
        if (IsStreaming)
        {
            return;
        }

        await ForgetConversationAsync();
        FocusedDevice = null;
        Transcript.Clear();
        Error = null;
    }

    private async Task ForgetConversationAsync()
    {
        if (_conversationId is not { } conversationId)
        {
            return;
        }

        try
        {
            await _session.Client.DeleteAiConversationAsync(
                _session.Token,
                conversationId,
                _lifetime.Token);
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or TaskCanceledException)
        {
            AssistantLog.ClearFailed(_logger, failure);
        }
        finally
        {
            _conversationId = null;
        }
    }

    private async Task StreamAnswerAsync(string content)
    {
        Error = null;
        var pending = new AssistantChatEntry(_time.GetLocalNow());
        Transcript.Add(pending);
        IsStreaming = true;
        var startsConversation = _conversationId is null;
        var conversationId = _conversationId ?? Guid.NewGuid().ToString();
        _conversationId = conversationId;
        try
        {
            await _realtime.SendAiMessageAsync(
                content,
                conversationId,
                FocusedDevice?.Id,
                _lifetime.Token);
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
            if (startsConversation)
            {
                _conversationId = null;
            }

            Transcript.Remove(pending);
            IsStreaming = false;
        }
        catch (RealtimeUnavailableException failure)
        {
            if (startsConversation)
            {
                _conversationId = null;
            }

            AssistantLog.SendFailed(_logger, failure);
            Transcript.Remove(pending);
            IsStreaming = false;
            Error = "Could not reach the appliance. Check the connection and try again.";
        }
    }

    private void OnAiToken(AiTokenEvent received)
    {
        // Only the answer being streamed right now grows; a token echoed to this client
        // for a conversation driven from another window has nowhere to land, like the web.
        if (received.ConversationId == _conversationId
            && Transcript.LastOrDefault() is AssistantChatEntry { IsStreaming: true } entry)
        {
            entry.Content += received.Token;
        }
    }

    private void OnAiComplete(AiCompleteEvent received)
    {
        if (received.ConversationId != _conversationId)
        {
            return;
        }

        foreach (var entry in Transcript.OfType<AssistantChatEntry>().Where(e => e.IsStreaming))
        {
            entry.Content = received.Content;
            entry.UsageWarning = received.UsageWarning;
            entry.ProviderUnavailable = received.ProviderStatus == "unavailable";
            entry.IsStreaming = false;
        }

        _conversationId = received.ConversationId;
        IsStreaming = false;
        ProviderAvailable = received.ProviderStatus != "unavailable";
    }

    private void OnRealtimeError(RealtimeErrorEvent received)
    {
        if (received.Context != "ai")
        {
            return;
        }

        Error = received.Code switch
        {
            "AI_001" => "Hourly message limit reached. Try again next hour.",
            "AI_002" => "Daily message limit reached. Try again tomorrow.",
            "AI_003" => "Monthly token budget exhausted.",
            _ => "Something went wrong. Please try again.",
        };
        IsStreaming = false;
        // Deliberate deviation: the web left the empty bubble until retry filtered it;
        // dropping it with the error reads as one event, not a stuck answer.
        RemoveUnstartedAnswers();
    }

    private void RemoveUnstartedAnswers()
    {
        foreach (var stale in Transcript.OfType<AssistantChatEntry>()
                     .Where(e => e.IsStreaming && e.Content.Length == 0)
                     .ToList())
        {
            Transcript.Remove(stale);
        }
    }

    private async Task LoadUsageAsync()
    {
        IsLoadingUsage = true;
        try
        {
            Usage = await _session.Client.GetAiUsageAsync(_session.Token, _lifetime.Token);
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or TaskCanceledException)
        {
            // The chat still works without the counters; the summary line just stays empty.
            AssistantLog.UsageLoadFailed(_logger, failure);
        }
        finally
        {
            IsLoadingUsage = false;
        }
    }

    partial void OnUsageChanged(AiUsage? value) => NotifyDerivedState();

    partial void OnIsLoadingUsageChanged(bool value) => OnPropertyChanged(nameof(UsageSummary));

    partial void OnProviderAvailableChanged(bool value) => NotifyDerivedState();

    partial void OnFocusedDeviceChanged(FocusedAssistantDevice? value) =>
        OnPropertyChanged(nameof(InputPlaceholder));

    partial void OnInputChanged(string value) => OnPropertyChanged(nameof(CanSend));

    partial void OnIsStreamingChanged(bool value)
    {
        OnPropertyChanged(nameof(CanSend));
        OnPropertyChanged(nameof(CanType));
    }

    private void NotifyDerivedState()
    {
        OnPropertyChanged(nameof(IsLimitReached));
        OnPropertyChanged(nameof(InputPlaceholder));
        OnPropertyChanged(nameof(UsageSummary));
        OnPropertyChanged(nameof(BannerText));
        OnPropertyChanged(nameof(BannerIsAlert));
        OnPropertyChanged(nameof(BannerIsCaution));
        OnPropertyChanged(nameof(CanSend));
        OnPropertyChanged(nameof(CanType));
        SendCommand.NotifyCanExecuteChanged();
    }
}

internal static partial class AssistantLog
{
    [LoggerMessage(Level = LogLevel.Warning, Message = "Assistant message send failed")]
    public static partial void SendFailed(ILogger logger, Exception exception);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Assistant usage read failed")]
    public static partial void UsageLoadFailed(ILogger logger, Exception exception);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Assistant conversation delete failed; clearing locally")]
    public static partial void ClearFailed(ILogger logger, Exception exception);
}
