using Avalonia;
using NodeScope.Desktop.Hosting;

namespace NodeScope.Desktop;

/// <summary>Entry point for the desktop client.</summary>
/// <remarks>
/// Single-instance is settled here, before Avalonia spins up: bind the instance socket and
/// become the primary, or hand our activation to the running instance and exit. Avalonia
/// setup lives in <see cref="BuildAvaloniaApp"/> by convention so the XAML previewer can
/// construct the app; the headless test host builds its own <c>AppBuilder</c> over the same
/// <see cref="App"/> with the headless platform instead (Decision 18).
/// </remarks>
internal static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        var callback = Array.Find(
            args, arg => arg.StartsWith(DesktopCallbackPrefix, StringComparison.OrdinalIgnoreCase));

        var socketPath = SingleInstance.DefaultSocketPath;
        SingleInstance? primary = null;
        try
        {
            primary = SingleInstance.TryStartPrimary(socketPath, App.Activations.Post);
            if (primary is null)
            {
                if (SingleInstance.TryForward(socketPath, callback ?? SingleInstance.ActivateMessage))
                {
                    return 0; // delivered to the running window
                }

                // Nobody listening behind the bound address: a stale socket file from a crash.
                File.Delete(socketPath);
                primary = SingleInstance.TryStartPrimary(socketPath, App.Activations.Post);
            }

            if (callback is not null)
            {
                App.Activations.Post(callback);
            }

            return BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
        }
        finally
        {
            primary?.Dispose();
        }
    }

    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>()
            .UsePlatformDetect()
            .WithInterFont()
            .LogToTrace();

    private const string DesktopCallbackPrefix = "nodescope://";
}
