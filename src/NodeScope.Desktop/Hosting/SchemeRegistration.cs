using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.Versioning;
using Microsoft.Extensions.Logging;
using Microsoft.Win32;

namespace NodeScope.Desktop.Hosting;

/// <summary>
/// Registers this executable as the nodescope:// handler for the current user, idempotently
/// at every startup - registration follows the binary when it moves. Best-effort: a client
/// that cannot register still runs; only browser sign-in completion is affected, and the
/// failure is in the log.
/// </summary>
internal static class SchemeRegistration
{
    public static void EnsureRegistered(ILogger logger)
    {
        var exePath = Environment.ProcessPath;
        if (exePath is null)
        {
            HostingLog.SchemeRegistrationFailed(logger, "the process path is unknown");
            return;
        }

        try
        {
            if (OperatingSystem.IsWindows())
            {
                RegisterWindows(exePath);
            }
            else if (OperatingSystem.IsLinux())
            {
                var applications = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "applications");
                RegisterLinux(applications, exePath, logger);
            }
            else
            {
                HostingLog.SchemeRegistrationFailed(logger, "unsupported OS");
                return;
            }

            HostingLog.SchemeRegistered(logger, exePath);
        }
        catch (Exception failure) when (
            failure is IOException or UnauthorizedAccessException or System.Security.SecurityException)
        {
            HostingLog.SchemeRegistrationFailed(logger, failure.Message);
        }
    }

    /// <summary>HKCU\Software\Classes\nodescope - per-user, no elevation needed.</summary>
    [SupportedOSPlatform("windows")]
    private static void RegisterWindows(string exePath)
    {
        using var scheme = Registry.CurrentUser.CreateSubKey(@"Software\Classes\nodescope");
        scheme.SetValue(null, "URL:NodeScope");
        scheme.SetValue("URL Protocol", string.Empty);
        using var command = scheme.CreateSubKey(@"shell\open\command");
        command.SetValue(null, $"\"{exePath}\" \"%1\"");
    }

    /// <summary>
    /// A hidden .desktop entry claiming x-scheme-handler/nodescope, plus a best-effort
    /// xdg-mime default so browsers resolve it without a re-login.
    /// </summary>
    private static void RegisterLinux(string applicationsDir, string exePath, ILogger logger)
    {
        var fileName = WriteDesktopFileIfChanged(applicationsDir, exePath);

        try
        {
            using var xdg = Process.Start(new ProcessStartInfo(
                "xdg-mime", ["default", fileName, "x-scheme-handler/nodescope"]));
            xdg?.WaitForExit(5000);
        }
        catch (Win32Exception)
        {
            // No xdg-mime on this box; the .desktop MimeType line still resolves on most
            // desktops after the association cache refreshes.
            HostingLog.SchemeRegistrationFailed(logger, "xdg-mime is not available");
        }
    }

    /// <summary>The file half of Linux registration, separated so tests never touch xdg-mime.</summary>
    internal static string WriteDesktopFileIfChanged(string applicationsDir, string exePath)
    {
        const string FileName = "nodescope-desktop.desktop";
        var path = Path.Combine(applicationsDir, FileName);
        var entry = BuildDesktopEntry(exePath);

        Directory.CreateDirectory(applicationsDir);
        if (!File.Exists(path) || File.ReadAllText(path) != entry)
        {
            File.WriteAllText(path, entry);
        }

        return FileName;
    }

    /// <summary>NoDisplay: this entry exists for URL dispatch, not for app launchers.</summary>
    internal static string BuildDesktopEntry(string exePath) =>
        $"""
        [Desktop Entry]
        Type=Application
        Name=NodeScope
        Exec={exePath} %u
        Terminal=false
        NoDisplay=true
        MimeType=x-scheme-handler/nodescope;
        """ + "\n";
}
