using System.Reflection;
using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using Avalonia.Threading;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NodeScope.Desktop.Auth;
using NodeScope.Desktop.Composition;
using NodeScope.Desktop.Hosting;
using NodeScope.Desktop.ViewModels;
using NodeScope.Desktop.Views;

namespace NodeScope.Desktop;

/// <summary>The Avalonia application: theme, composition root, and shell window ownership.</summary>
internal sealed partial class App : Application
{
    private ServiceProvider? _services;

    /// <summary>
    /// Focus requests from forwarding secondaries. Static because Program posts before
    /// Avalonia constructs the App; the queue buffers until
    /// <see cref="OnFrameworkInitializationCompleted"/> subscribes.
    /// </summary>
    public static ActivationQueue Activations { get; } = new();

    public override void Initialize() => AvaloniaXamlLoader.Load(this);

    public override void OnFrameworkInitializationCompleted()
    {
        // Composition happens only under the real desktop lifetime; the headless test
        // host (Decision 18) constructs windows and providers itself.
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            _services = DesktopServices.BuildProvider(DesktopStorage.Default);
            var logger = _services.GetRequiredService<ILogger<App>>();
            AppLog.Starting(logger, ClientVersion, DesktopPaths.LogDirectory);

            // The theme choice is local-only (settings.json); apply it before any window shows.
            var storedTheme = _services.GetRequiredService<SettingsStore>().Load().Theme;
            RequestedThemeVariant = storedTheme switch
            {
                "light" => Avalonia.Styling.ThemeVariant.Light,
                "dark" => Avalonia.Styling.ThemeVariant.Dark,
                _ => Avalonia.Styling.ThemeVariant.Default,
            };

            var flow = _services.GetRequiredService<DesktopAuthFlow>();
            desktop.MainWindow = new MainWindow
            {
                DataContext = _services.GetRequiredService<MainWindowViewModel>(),
            };
            desktop.Exit += OnDesktopExit;

            Activations.Subscribe(message =>
                Dispatcher.UIThread.Post(() => HandleActivation(message, desktop, logger)));

            _ = RestoreSafelyAsync(flow, logger);
        }

        base.OnFrameworkInitializationCompleted();
    }

    private static void HandleActivation(
        string message, IClassicDesktopStyleApplicationLifetime desktop, ILogger logger)
    {
        if (message == SingleInstance.ActivateMessage)
        {
            desktop.MainWindow?.Activate();
            return;
        }

        HostingLog.ActivationIgnored(logger, message);
    }

    private static async Task RestoreSafelyAsync(DesktopAuthFlow flow, ILogger logger)
    {
        try
        {
            await flow.RestoreAsync(CancellationToken.None);
        }
        catch (Exception failure) when (failure is not OperationCanceledException)
        {
            HostingLog.RestoreCrashed(logger, failure);
        }
    }

    // Initialized once: evaluating the reflection lookup at the log call site trips CA1873.
    private static string ClientVersion { get; } =
        typeof(App).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()
            ?.InformationalVersion ?? "0.0.0";

    // Disposing the provider flushes and closes the file logger.
    private void OnDesktopExit(object? sender, ControlledApplicationLifetimeExitEventArgs e) =>
        _services?.Dispose();
}
