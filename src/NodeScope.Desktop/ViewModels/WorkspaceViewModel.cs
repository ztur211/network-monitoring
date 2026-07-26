using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Extensions.Logging;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Auth;
using NodeScope.Desktop.Bim;
using NodeScope.Desktop.Realtime;

namespace NodeScope.Desktop.ViewModels;

/// <summary>
/// One entry in the workspace nav rail. <see cref="Content"/> is the surface's view
/// model once the milestone shipped; null renders the placeholder text instead.
/// </summary>
internal sealed record WorkspaceSection(string Title, string Placeholder, object? Content = null);

/// <summary>The signed-in surface: nav rail, section content, user chip, sign-out.</summary>
[INotifyPropertyChanged]
internal sealed partial class WorkspaceViewModel : IDisposable
{
    private readonly DesktopAuthFlow _flow;
    private readonly ApplianceSession _session;
    private readonly ILoggerFactory _loggers;
    private readonly IRealtimeConnection _realtime;
    private readonly MapViewModel _map;
    private readonly BimViewerViewModel _bimViewer;
    private readonly InventoryViewModel _inventory;
    private readonly AssistantViewModel _assistant;
    private readonly SettingsViewModel _settings;
    private readonly CancellationTokenSource _lifetime = new();

    [ObservableProperty]
    private WorkspaceSection _selectedSection;

    /// <summary>The onboarding wizard overlay, open while the org still has no network.</summary>
    [ObservableProperty]
    private OnboardingViewModel? _wizard;

    public WorkspaceViewModel(
        CurrentUser user,
        Uri serverUrl,
        DesktopAuthFlow flow,
        ApplianceSession session,
        SettingsStore settingsStore,
        ILoggerFactory loggers,
        IIfcTessellator tessellator,
        IRealtimeConnection realtime)
    {
        _flow = flow;
        _session = session;
        _loggers = loggers;
        User = user;
        ServerUrl = serverUrl;
        _realtime = realtime;
        _map = new MapViewModel(session, user, loggers.CreateLogger<MapViewModel>());
        _bimViewer = new BimViewerViewModel(
            session,
            loggers.CreateLogger<BimViewerViewModel>(),
            tessellator);
        _inventory = new InventoryViewModel(session, loggers);
        _assistant = new AssistantViewModel(
            session, realtime, loggers.CreateLogger<AssistantViewModel>());
        _settings = new SettingsViewModel(
            session, user, settingsStore, loggers.CreateLogger<SettingsViewModel>());

        Sections =
        [
            new("Map", "The GIS map arrives with the Mapsui + tileserver-gl milestone.", _map),
            new("3D Viewer", "Loading the native BIM viewer.", _bimViewer),
            new("Inventory", "Loading equipment, circuits and clients.", _inventory),
            new("Assistant", "Loading the assistant.", _assistant),
            new("Settings", "Loading settings.", _settings),
        ];
        _selectedSection = Sections[0];
        // Web parity: the realtime wire comes up with the workspace, not with a section.
        realtime.Start();
        WizardCheck = MaybeOpenWizardAsync();
    }

    /// <summary>The wizard auto-open probe; awaited by tests.</summary>
    internal Task WizardCheck { get; }

    public CurrentUser User { get; }

    public Uri ServerUrl { get; }

    public string UserLabel => User.Name is { Length: > 0 } name ? name : User.Email;

    /// <summary>The step-5 build order, one entry per surface.</summary>
    public IReadOnlyList<WorkspaceSection> Sections { get; }

    public void Dispose()
    {
        _lifetime.Cancel();
        _lifetime.Dispose();
        _map.Dispose();
        _bimViewer.Dispose();
        _inventory.Dispose();
        _assistant.Dispose();
        _settings.Dispose();
        _realtime.Dispose();
        Wizard?.Dispose();
    }

    [RelayCommand]
    private Task SignOutAsync() => _flow.SignOutAsync(CancellationToken.None);

    /// <summary>
    /// Web parity: the wizard auto-opens when the org has no network yet. The turn
    /// endpoint is OWNER/ADMIN, so a MEMBER of a network-less org never sees it.
    /// Closing it (skip or done) keeps it closed for this session.
    /// </summary>
    private async Task MaybeOpenWizardAsync()
    {
        try
        {
            var networksTask = _session.Client.GetNetworksAsync(_session.Token, _lifetime.Token);
            var accessTask = _session.Client.GetAccessSummaryAsync(_session.Token, _lifetime.Token);
            await Task.WhenAll(networksTask, accessTask);
            if ((await networksTask).Count == 0 && (await accessTask).CanConfigure)
            {
                Wizard = new OnboardingViewModel(
                    _session,
                    _loggers.CreateLogger<OnboardingViewModel>(),
                    close: CloseWizard);
            }
        }
        catch (Exception failure) when (
            failure is ApplianceApiException or HttpRequestException or TaskCanceledException)
        {
            WorkspaceLog.WizardProbeFailed(_loggers.CreateLogger<WorkspaceViewModel>(), failure);
        }
    }

    private void CloseWizard()
    {
        Wizard?.Dispose();
        Wizard = null;
    }
}

internal static partial class WorkspaceLog
{
    [LoggerMessage(Level = LogLevel.Warning, Message = "Onboarding auto-open probe failed")]
    public static partial void WizardProbeFailed(ILogger logger, Exception exception);
}
