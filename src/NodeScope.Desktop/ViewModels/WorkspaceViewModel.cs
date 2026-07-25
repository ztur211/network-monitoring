using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Auth;

namespace NodeScope.Desktop.ViewModels;

/// <summary>One entry in the workspace nav rail; placeholders until each surface lands.</summary>
internal sealed record WorkspaceSection(string Title, string Placeholder);

/// <summary>The signed-in surface: nav rail, section content, user chip, sign-out.</summary>
[INotifyPropertyChanged]
internal sealed partial class WorkspaceViewModel
{
    private readonly DesktopAuthFlow _flow;

    [ObservableProperty]
    private WorkspaceSection _selectedSection;

    public WorkspaceViewModel(CurrentUser user, Uri serverUrl, DesktopAuthFlow flow)
    {
        _flow = flow;
        User = user;
        ServerUrl = serverUrl;
        _selectedSection = Sections[0];
    }

    public CurrentUser User { get; }

    public Uri ServerUrl { get; }

    public string UserLabel => User.Name is { Length: > 0 } name ? name : User.Email;

    /// <summary>The step-5 build order, one placeholder per surface.</summary>
    public IReadOnlyList<WorkspaceSection> Sections { get; } =
    [
        new("Map", "The GIS map arrives with the Mapsui + tileserver-gl milestone."),
        new("3D Viewer", "The BIM viewer arrives with the wexbim milestone (Windows first)."),
        new("Inventory", "Devices, networks, circuits and clients arrive with the CRUD milestone."),
        new("Assistant", "Chat arrives once the client core is in place."),
        new("Settings", "Client settings arrive here; sign-out lives in the header for now."),
    ];

    [RelayCommand]
    private Task SignOutAsync() => _flow.SignOutAsync(CancellationToken.None);
}
