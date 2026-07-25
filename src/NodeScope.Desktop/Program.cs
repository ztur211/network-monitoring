using Avalonia;

namespace NodeScope.Desktop;

/// <summary>Entry point for the desktop client.</summary>
/// <remarks>
/// Avalonia setup lives in <see cref="BuildAvaloniaApp"/> by convention so the XAML
/// previewer can construct the app. The headless test host builds its own
/// <c>AppBuilder</c> over the same <see cref="App"/> instead, swapping
/// <c>UsePlatformDetect</c> for the headless platform (Decision 18).
/// </remarks>
internal static class Program
{
    [STAThread]
    public static void Main(string[] args) => BuildAvaloniaApp()
        .StartWithClassicDesktopLifetime(args);

    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>()
            .UsePlatformDetect()
            .WithInterFont()
            .LogToTrace();
}
