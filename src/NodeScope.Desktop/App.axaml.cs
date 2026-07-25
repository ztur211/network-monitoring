using System.Reflection;
using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NodeScope.Desktop.Composition;
using NodeScope.Desktop.ViewModels;
using NodeScope.Desktop.Views;

namespace NodeScope.Desktop;

/// <summary>The Avalonia application: theme, composition root, and shell window ownership.</summary>
internal sealed partial class App : Application
{
    private ServiceProvider? _services;

    public override void Initialize() => AvaloniaXamlLoader.Load(this);

    public override void OnFrameworkInitializationCompleted()
    {
        // Composition happens only under the real desktop lifetime; the headless test
        // host (Decision 18) constructs windows and providers itself.
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            _services = DesktopServices.BuildProvider(DesktopPaths.LogDirectory);
            var logger = _services.GetRequiredService<ILogger<App>>();
            AppLog.Starting(logger, ClientVersion, DesktopPaths.LogDirectory);

            desktop.MainWindow = new MainWindow
            {
                DataContext = _services.GetRequiredService<MainWindowViewModel>(),
            };
            desktop.Exit += OnDesktopExit;
        }

        base.OnFrameworkInitializationCompleted();
    }

    // Initialized once: evaluating the reflection lookup at the log call site trips CA1873.
    private static string ClientVersion { get; } =
        typeof(App).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()
            ?.InformationalVersion ?? "0.0.0";

    // Disposing the provider flushes and closes the file logger.
    private void OnDesktopExit(object? sender, ControlledApplicationLifetimeExitEventArgs e) =>
        _services?.Dispose();
}
