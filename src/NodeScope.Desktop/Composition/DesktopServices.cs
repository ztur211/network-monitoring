using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Auth;
using NodeScope.Desktop.Logging;
using NodeScope.Desktop.ViewModels;

namespace NodeScope.Desktop.Composition;

/// <summary>Where the client's persistent files live; a record so tests aim it at scratch space.</summary>
internal sealed record DesktopStorage(string LogDirectory, string SettingsFile, string VaultFile)
{
    public static DesktopStorage Default { get; } = new(
        DesktopPaths.LogDirectory, DesktopPaths.SettingsFile, DesktopPaths.VaultFile);
}

/// <summary>Composition root for the desktop client.</summary>
/// <remarks>
/// A plain <see cref="ServiceProvider"/> rather than the Generic Host: Avalonia owns the
/// process lifetime and the client runs no hosted services. Logging is Decision 19's
/// posture - first-party MEL into a rolling file under app data, nothing exported anywhere.
/// </remarks>
internal static class DesktopServices
{
    public static ServiceProvider BuildProvider(DesktopStorage storage)
    {
        var services = new ServiceCollection();

        services.AddLogging(logging =>
        {
            logging.SetMinimumLevel(LogLevel.Information);
            // Factory registration so the container owns (and disposes) the provider.
            logging.Services.AddSingleton<ILoggerProvider>(_ => new FileLoggerProvider(storage.LogDirectory));
        });

        services.AddSingleton<IApplianceClientFactory, ApplianceClientFactory>();
        services.AddSingleton(_ => new SettingsStore(storage.SettingsFile));
        // Decision 17: DPAPI where the OS offers it; the 0600 plain file is the dev vault.
        services.AddSingleton<ITokenVault>(_ => OperatingSystem.IsWindows()
            ? new DpapiTokenVault(storage.VaultFile)
            : new PlainFileTokenVault(storage.VaultFile));
        services.AddSingleton<IBrowserLauncher, SystemBrowserLauncher>();
        services.AddSingleton<DesktopAuthFlow>();

        services.AddSingleton<MainWindowViewModel>();

        return services.BuildServiceProvider();
    }
}
