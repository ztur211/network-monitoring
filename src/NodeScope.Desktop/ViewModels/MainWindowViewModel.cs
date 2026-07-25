using CommunityToolkit.Mvvm.ComponentModel;
using NodeScope.Desktop.Auth;

namespace NodeScope.Desktop.ViewModels;

/// <summary>The shell: switches between sign-in and workspace as the session changes.</summary>
/// <remarks>
/// <c>[INotifyPropertyChanged]</c> embeds the INPC implementation via source generation
/// instead of inheriting <c>ObservableObject</c>: Decision 6 reserves inheritance for
/// framework integration, and the MVVM toolkit offers this composition path exactly so
/// a base class is not forced on every view model.
/// </remarks>
[INotifyPropertyChanged]
internal sealed partial class MainWindowViewModel : IDisposable
{
    private readonly DesktopAuthFlow _flow;

    /// <summary>The active surface: <see cref="SignInViewModel"/> or <see cref="WorkspaceViewModel"/>.</summary>
    [ObservableProperty]
    private object _content;

    /// <summary>Connection state shown in the status bar.</summary>
    [ObservableProperty]
    private string _status = "Not signed in";

    public MainWindowViewModel(DesktopAuthFlow flow, SettingsStore settings)
    {
        _flow = flow;
        SignIn = new SignInViewModel(flow, settings);
        _content = SignIn;
        flow.StateChanged += OnStateChanged;
        Apply(flow.Current);
    }

    public SignInViewModel SignIn { get; }

    public void Dispose() => _flow.StateChanged -= OnStateChanged;

    private void OnStateChanged(object? sender, EventArgs e) => Apply(_flow.Current);

    private void Apply(SessionSnapshot snapshot)
    {
        if (snapshot is { Phase: SessionPhase.SignedIn, User: not null, ServerUrl: not null })
        {
            var workspace = new WorkspaceViewModel(snapshot.User, snapshot.ServerUrl, _flow);
            Content = workspace;
            Status = $"Signed in as {workspace.UserLabel} - {snapshot.ServerUrl.Host}";
            return;
        }

        SignIn.Apply(snapshot);
        Content = SignIn;
        Status = snapshot.Phase switch
        {
            SessionPhase.WaitingForBrowser => "Waiting for the browser sign-in…",
            SessionPhase.Exchanging => "Completing sign-in…",
            SessionPhase.Unreachable => $"Appliance unreachable - {snapshot.ServerUrl?.Host}",
            _ => "Not signed in",
        };
    }
}
