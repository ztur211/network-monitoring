using Avalonia.Controls;
using NodeScope.Desktop.ViewModels;

namespace NodeScope.Desktop.Views;

/// <summary>
/// Hosts the Mapsui control for <see cref="MapViewModel"/>. The view model owns the
/// Mapsui <c>Map</c> (layers, tap handling, viewport events); this code-behind only
/// hands it to the control, because <c>MapControl.Map</c> is not a bindable property.
/// </summary>
internal sealed partial class MapView : UserControl
{
    public MapView()
    {
        InitializeComponent();
        DataContextChanged += (_, _) =>
        {
            if (DataContext is MapViewModel viewModel)
            {
                MapHost.Map = viewModel.SharedMap;
            }
        };
    }
}
