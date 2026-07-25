using Avalonia;
using Avalonia.Headless;
using NodeScope.Desktop;
using NodeScope.Desktop.Tests;

[assembly: AvaloniaTestApplication(typeof(TestAppBuilder))]

namespace NodeScope.Desktop.Tests;

/// <summary>
/// Builds the real <see cref="App"/> on the headless platform for every
/// <c>[AvaloniaFact]</c> test in this assembly (Decision 18).
/// </summary>
public static class TestAppBuilder
{
    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>()
            .UseSkia()
            .UseHeadless(new AvaloniaHeadlessPlatformOptions
            {
                UseHeadlessDrawing = false,
                ShouldRenderOnUIThread = true,
            });
}
