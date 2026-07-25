using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Extensions.Logging;
using NodeScope.Desktop.Api;

namespace NodeScope.Desktop.ViewModels;

/// <summary>A bot line of the wizard transcript.</summary>
internal sealed record BotEntry(string Message);

/// <summary>The user's echoed answer.</summary>
internal sealed record UserEntry(string Message);

/// <summary>One input of the current step, editable.</summary>
[INotifyPropertyChanged]
internal sealed partial class WizardFieldInput(OnboardingField field)
{
    [ObservableProperty]
    private string _text = "";

    public OnboardingField Field { get; } = field;

    public bool IsRequired => Field.Required == true;

    public string Watermark => Field.Placeholder ?? "";
}

/// <summary>
/// The onboarding wizard: a chat renderer over the server-side state machine
/// (<c>POST /onboarding/turn</c>). The client sends chip picks and field values and
/// draws whatever comes back; every transition and side effect is the server's.
/// Opens over the workspace when the org has no network yet.
/// </summary>
[INotifyPropertyChanged]
internal sealed partial class OnboardingViewModel : IDisposable
{
    private readonly ApplianceSession _session;
    private readonly ILogger _logger;
    private readonly Action _close;
    private readonly CancellationTokenSource _lifetime = new();

    [ObservableProperty]
    private IReadOnlyList<OnboardingChip> _chips = [];

    [ObservableProperty]
    private IReadOnlyList<WizardFieldInput> _fields = [];

    [ObservableProperty]
    private bool _isBusy;

    [ObservableProperty]
    private string? _error;

    [ObservableProperty]
    private bool _isComplete;

    public OnboardingViewModel(ApplianceSession session, ILogger logger, Action close)
    {
        _session = session;
        _logger = logger;
        _close = close;
        Initialization = SendAsync(chipChoice: null, fieldValues: null, echo: null);
    }

    /// <summary>The opening turn; awaited by tests.</summary>
    internal Task Initialization { get; }

    public ObservableCollection<object> Transcript { get; } = [];

    public bool HasFields => Fields.Count > 0;

    public void Dispose()
    {
        _lifetime.Cancel();
        _lifetime.Dispose();
    }

    [RelayCommand]
    private Task PickChipAsync(OnboardingChip chip)
    {
        // "Close" on the done step is purely client-side, like the web.
        if (chip.Value == "close")
        {
            _close();
            return Task.CompletedTask;
        }

        return SendAsync(chip.Value, fieldValues: null, echo: chip.Label);
    }

    [RelayCommand]
    private Task SubmitFieldsAsync()
    {
        var values = new Dictionary<string, object>(StringComparer.Ordinal);
        var echoes = new List<string>();
        foreach (var input in Fields)
        {
            var text = input.Text.Trim();
            if (text.Length == 0)
            {
                if (input.IsRequired)
                {
                    Error = $"{input.Field.Label} is required.";
                    return Task.CompletedTask;
                }

                continue;
            }

            if (input.Field.Kind == "number")
            {
                if (!double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var number))
                {
                    Error = $"{input.Field.Label} must be a number.";
                    return Task.CompletedTask;
                }

                values[input.Field.Key] = number;
            }
            else
            {
                values[input.Field.Key] = text;
            }

            echoes.Add(text);
        }

        if (values.Count == 0)
        {
            Error = "Fill in at least one field, or skip.";
            return Task.CompletedTask;
        }

        return SendAsync(chipChoice: null, values, string.Join(", ", echoes));
    }

    /// <summary>"Skip for now": dismisses server-side, then closes - best-effort like the web.</summary>
    [RelayCommand]
    private async Task SkipAsync()
    {
        try
        {
            await _session.Client.SkipOnboardingAsync(_session.Token, _lifetime.Token);
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            OnboardingLog.SkipFailed(_logger, failure);
        }

        _close();
    }

    private async Task SendAsync(
        string? chipChoice, IReadOnlyDictionary<string, object>? fieldValues, string? echo)
    {
        IsBusy = true;
        Error = null;
        try
        {
            var turn = await _session.Client.SendOnboardingTurnAsync(
                _session.Token, chipChoice, fieldValues, _lifetime.Token);
            if (echo is { Length: > 0 })
            {
                Transcript.Add(new UserEntry(echo));
            }

            Transcript.Add(new BotEntry(turn.BotMessage));
            Chips = turn.Chips;
            Fields = [.. turn.Fields.Select(field => new WizardFieldInput(field))];
            IsComplete = turn.Complete;
            OnPropertyChanged(nameof(HasFields));
        }
        catch (ApplianceApiException failure) when (failure.Code == "ONBOARD_002")
        {
            // Already complete: nothing to walk - close without noise, like the web.
            _close();
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            Error = failure.Message;
            OnboardingLog.TurnFailed(_logger, failure);
        }
        finally
        {
            IsBusy = false;
        }
    }
}

internal static partial class OnboardingLog
{
    [LoggerMessage(Level = LogLevel.Warning, Message = "Onboarding turn failed")]
    public static partial void TurnFailed(ILogger logger, Exception exception);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Onboarding skip failed; closing anyway")]
    public static partial void SkipFailed(ILogger logger, Exception exception);
}
