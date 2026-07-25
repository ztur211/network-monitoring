using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NodeScope.Desktop.Logging;
using NodeScope.Desktop.ViewModels;

namespace NodeScope.Desktop.Composition;

/// <summary>Composition root for the desktop client.</summary>
/// <remarks>
/// A plain <see cref="ServiceProvider"/> rather than the Generic Host: Avalonia owns the
/// process lifetime and the client runs no hosted services. Logging is Decision 19's
/// posture - first-party MEL into a rolling file under app data, nothing exported
/// anywhere. The log directory is a parameter so tests compose the real graph against a
/// scratch directory.
/// </remarks>
internal static class DesktopServices
{
    public static ServiceProvider BuildProvider(string logDirectory)
    {
        var services = new ServiceCollection();

        services.AddLogging(logging =>
        {
            logging.SetMinimumLevel(LogLevel.Information);
            // Factory registration so the container owns (and disposes) the provider.
            logging.Services.AddSingleton<ILoggerProvider>(_ => new FileLoggerProvider(logDirectory));
        });

        services.AddSingleton<MainWindowViewModel>();

        return services.BuildServiceProvider();
    }
}
