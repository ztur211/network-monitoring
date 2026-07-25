namespace NodeScope.Desktop;

/// <summary>Well-known per-user directories the client writes to.</summary>
internal static class DesktopPaths
{
    /// <summary>
    /// Log directory in per-user app data: roaming AppData on Windows, ~/.config on Linux.
    /// Decision 19: the client logs to a rolling file here and nowhere else.
    /// </summary>
    public static string LogDirectory { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "NodeScope",
        "logs");
}
