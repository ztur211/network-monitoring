using CommunityToolkit.Mvvm.ComponentModel;
using Microsoft.Extensions.Logging;
using NodeScope.Desktop.Auth;
using NodeScope.Desktop.Bim;
using NodeScope.Desktop.Realtime;

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

    private readonly ILoggerFactory _loggers;
    private readonly IIfcTessellator _tessellator;
    private readonly SettingsStore _settings;
    private readonly IRealtimeConnectionFactory _realtimeFactory;

    public MainWindowViewModel(
        DesktopAuthFlow flow,
        SettingsStore settings,
        ILoggerFactory loggers,
        IIfcTessellator tessellator,
        IRealtimeConnectionFactory realtimeFactory)
    {
        _flow = flow;
        _loggers = loggers;
        _tessellator = tessellator;
        _settings = settings;
        _realtimeFactory = realtimeFactory;
        SignIn = new SignInViewModel(flow, settings);
        _content = SignIn;
        flow.StateChanged += OnStateChanged;
        Apply(flow.Current);
    }

    public SignInViewModel SignIn { get; }

    public void Dispose()
    {
        _flow.StateChanged -= OnStateChanged;
        (Content as IDisposable)?.Dispose();
    }

    private void OnStateChanged(object? sender, EventArgs e) => Apply(_flow.Current);

    private void Apply(SessionSnapshot snapshot)
    {
        // A replaced workspace releases its feature view models (map layers, timers).
        var previous = Content as WorkspaceViewModel;

        if (snapshot is { Phase: SessionPhase.SignedIn, User: not null, ServerUrl: not null }
            && _flow.Session is { } session)
        {
            // The dormant form must not keep the credentials that just succeeded.
            SignIn.Apply(snapshot);
            var workspace = new WorkspaceViewModel(
                snapshot.User,
                snapshot.ServerUrl,
                _flow,
                session,
                _settings,
                _loggers,
                _tessellator,
                _realtimeFactory.Create(snapshot.ServerUrl, session.Token));
            Content = workspace;
            Status = $"Signed in as {workspace.UserLabel} - {snapshot.ServerUrl.Host}";
            previous?.Dispose();
            return;
        }

        SignIn.Apply(snapshot);
        Content = SignIn;
        previous?.Dispose();
        Status = snapshot.Phase switch
        {
            SessionPhase.SigningIn => "Signing in…",
            SessionPhase.Unreachable => $"Appliance unreachable - {snapshot.ServerUrl?.Host}",
            _ => "Not signed in",
        };
    }
}
