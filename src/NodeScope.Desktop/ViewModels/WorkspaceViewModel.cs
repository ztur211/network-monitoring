using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Extensions.Logging;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Auth;

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
    private readonly MapViewModel _map;

    [ObservableProperty]
    private WorkspaceSection _selectedSection;

    public WorkspaceViewModel(
        CurrentUser user,
        Uri serverUrl,
        DesktopAuthFlow flow,
        ApplianceSession session,
        ILoggerFactory loggers)
    {
        _flow = flow;
        User = user;
        ServerUrl = serverUrl;
        _map = new MapViewModel(session, user, loggers.CreateLogger<MapViewModel>());

        Sections =
        [
            new("Map", "The GIS map arrives with the Mapsui + tileserver-gl milestone.", _map),
            new("3D Viewer", "The BIM viewer arrives with the wexbim milestone (Windows first)."),
            new("Inventory", "Devices, networks, circuits and clients arrive with the CRUD milestone."),
            new("Assistant", "Chat arrives once the client core is in place."),
            new("Settings", "Client settings arrive here; sign-out lives in the header for now."),
        ];
        _selectedSection = Sections[0];
    }

    public CurrentUser User { get; }

    public Uri ServerUrl { get; }

    public string UserLabel => User.Name is { Length: > 0 } name ? name : User.Email;

    /// <summary>The step-5 build order, one entry per surface.</summary>
    public IReadOnlyList<WorkspaceSection> Sections { get; }

    public void Dispose() => _map.Dispose();

    [RelayCommand]
    private Task SignOutAsync() => _flow.SignOutAsync(CancellationToken.None);
}
