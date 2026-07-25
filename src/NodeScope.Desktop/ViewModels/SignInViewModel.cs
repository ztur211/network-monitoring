using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using NodeScope.Desktop.Auth;

namespace NodeScope.Desktop.ViewModels;

/// <summary>The signed-out surface: appliance URL, browser sign-in, progress, errors.</summary>
[INotifyPropertyChanged]
internal sealed partial class SignInViewModel
{
    private readonly DesktopAuthFlow _flow;

    [ObservableProperty]
    private string _serverUrl;

    [ObservableProperty]
    private string? _error;

    /// <summary>True from browser launch until the exchange settles; gates the form.</summary>
    [ObservableProperty]
    private bool _busy;

    [ObservableProperty]
    private string? _progress;

    /// <summary>A stored session exists but the appliance did not answer (retry keeps it).</summary>
    [ObservableProperty]
    private bool _canRetry;

    public SignInViewModel(DesktopAuthFlow flow, SettingsStore settings)
    {
        _flow = flow;
        _serverUrl = settings.Load().ApplianceUrl?.AbsoluteUri ?? string.Empty;
    }

    [RelayCommand]
    private void SignIn()
    {
        if (!Uri.TryCreate(ServerUrl.Trim(), UriKind.Absolute, out var url)
            || (url.Scheme != Uri.UriSchemeHttp && url.Scheme != Uri.UriSchemeHttps))
        {
            Error = "Enter the appliance URL, like https://nodescope.example.com";
            return;
        }

        _flow.StartSignIn(url);
    }

    [RelayCommand]
    private void Cancel() => _flow.CancelSignIn();

    [RelayCommand]
    private Task RetryAsync() => _flow.RestoreAsync(CancellationToken.None);

    /// <summary>Projects a flow snapshot onto the form. Called by the shell on every transition.</summary>
    public void Apply(SessionSnapshot snapshot)
    {
        if (snapshot.ServerUrl is not null)
        {
            ServerUrl = snapshot.ServerUrl.AbsoluteUri;
        }

        Error = snapshot.Error;
        CanRetry = snapshot.Phase == SessionPhase.Unreachable;
        Busy = snapshot.Phase is SessionPhase.WaitingForBrowser or SessionPhase.Exchanging;
        Progress = snapshot.Phase switch
        {
            SessionPhase.WaitingForBrowser => "Finish signing in from your browser…",
            SessionPhase.Exchanging => "Completing sign-in…",
            _ => null,
        };
    }
}
