using CommunityToolkit.Mvvm.ComponentModel;

namespace NodeScope.Desktop.ViewModels;

/// <summary>View model for the shell window.</summary>
/// <remarks>
/// <c>[INotifyPropertyChanged]</c> embeds the INPC implementation via source generation
/// instead of inheriting <c>ObservableObject</c>: Decision 6 reserves inheritance for
/// framework integration, and the MVVM toolkit offers this composition path exactly so
/// a base class is not forced on every view model.
/// </remarks>
[INotifyPropertyChanged]
internal sealed partial class MainWindowViewModel
{
    /// <summary>Connection state shown in the status bar; becomes real when auth lands.</summary>
    [ObservableProperty]
    private string _status = "Not signed in";
}
