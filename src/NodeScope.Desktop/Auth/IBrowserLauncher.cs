using System.Diagnostics;

namespace NodeScope.Desktop.Auth;

/// <summary>Opens a URL in the user's default browser. A seam so flow tests never launch one.</summary>
internal interface IBrowserLauncher
{
    public void Open(Uri url);
}

/// <summary>
/// The real launcher: shell-execute on Windows (default browser), xdg-open elsewhere.
/// </summary>
internal sealed class SystemBrowserLauncher : IBrowserLauncher
{
    public void Open(Uri url)
    {
        // UseShellExecute routes through the OS URL association on Windows; on Linux the
        // equivalent association lives behind xdg-open.
        using var process = OperatingSystem.IsWindows()
            ? Process.Start(new ProcessStartInfo(url.AbsoluteUri) { UseShellExecute = true })
            : Process.Start(new ProcessStartInfo("xdg-open", [url.AbsoluteUri]));
        // The browser process is not ours to track; disposing releases the handle only.
    }
}
