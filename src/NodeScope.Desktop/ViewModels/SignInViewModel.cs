using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using NodeScope.Desktop.Auth;

namespace NodeScope.Desktop.ViewModels;

/// <summary>The signed-out surface: appliance URL + credentials, sign-in or create-account.</summary>
[INotifyPropertyChanged]
internal sealed partial class SignInViewModel
{
    private readonly DesktopAuthFlow _flow;

    [ObservableProperty]
    private string _serverUrl;

    [ObservableProperty]
    private string _email = string.Empty;

    [ObservableProperty]
    private string _password = string.Empty;

    /// <summary>Only submitted in create-account mode.</summary>
    [ObservableProperty]
    private string _name = string.Empty;

    /// <summary>False = sign in to an existing account, true = create one.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Title))]
    [NotifyPropertyChangedFor(nameof(SubmitLabel))]
    [NotifyPropertyChangedFor(nameof(SwitchPrompt))]
    [NotifyPropertyChangedFor(nameof(SwitchLabel))]
    private bool _creatingAccount;

    [ObservableProperty]
    private string? _error;

    /// <summary>True while the credential post is in flight; gates the form.</summary>
    [ObservableProperty]
    private bool _busy;

    /// <summary>A stored session exists but the appliance did not answer (retry keeps it).</summary>
    [ObservableProperty]
    private bool _canRetry;

    public SignInViewModel(DesktopAuthFlow flow, SettingsStore settings)
    {
        _flow = flow;
        _serverUrl = settings.Load().ApplianceUrl?.AbsoluteUri ?? string.Empty;
    }

    public string Title => CreatingAccount ? "Create your account" : "Sign in to your appliance";

    public string SubmitLabel => CreatingAccount ? "Create account" : "Sign in";

    public string SwitchPrompt => CreatingAccount ? "Already have an account?" : "Don't have an account?";

    public string SwitchLabel => CreatingAccount ? "Sign in" : "Create one";

    [RelayCommand]
    private async Task SubmitAsync()
    {
        if (!Uri.TryCreate(ServerUrl.Trim(), UriKind.Absolute, out var url)
            || (url.Scheme != Uri.UriSchemeHttp && url.Scheme != Uri.UriSchemeHttps))
        {
            Error = "Enter the appliance URL, like https://nodescope.example.com";
            return;
        }

        if (CreatingAccount && Name.Trim().Length == 0)
        {
            Error = "Enter your name.";
            return;
        }

        if (Email.Trim().Length == 0 || Password.Length == 0)
        {
            Error = "Enter your email and password.";
            return;
        }

        if (CreatingAccount && Password.Length < 8)
        {
            // Mirrors the server policy so the round trip never ends in raw GEN_001 copy.
            Error = "Use a password of at least 8 characters.";
            return;
        }

        if (CreatingAccount)
        {
            await _flow.SignUpAsync(url, Name.Trim(), Email.Trim(), Password, CancellationToken.None);
        }
        else
        {
            await _flow.SignInAsync(url, Email.Trim(), Password, CancellationToken.None);
        }
    }

    [RelayCommand]
    private void SwitchMode()
    {
        CreatingAccount = !CreatingAccount;
        Error = null;
    }

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
        Busy = snapshot.Phase == SessionPhase.SigningIn;
        if (snapshot.Phase == SessionPhase.SignedIn)
        {
            // The password has done its job; never keep it around for the next sign-out.
            Password = string.Empty;
        }
    }
}
