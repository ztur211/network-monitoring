using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using NodeScope.Desktop.ViewModels;
using NodeScope.Desktop.Views;
using Xunit;

namespace NodeScope.Desktop.Tests;

public class MainWindowTests
{
    [AvaloniaFact]
    public void Shell_window_shows_with_the_product_title()
    {
        var window = new MainWindow { DataContext = new MainWindowViewModel() };
        window.Show();

        Assert.Equal("NodeScope", window.Title);
        Assert.True(window.IsVisible);
    }

    [AvaloniaFact]
    public void Status_bar_tracks_the_view_model()
    {
        var viewModel = new MainWindowViewModel();
        var window = new MainWindow { DataContext = viewModel };
        window.Show();

        var status = window.FindControl<TextBlock>("StatusText");
        Assert.NotNull(status);
        Assert.Equal("Not signed in", status.Text);

        viewModel.Status = "Connected to https://appliance.local";

        Assert.Equal("Connected to https://appliance.local", status.Text);
    }
}
