namespace NodeScope.Desktop;

/// <summary>Well-known per-user directories and files the client writes to.</summary>
internal static class DesktopPaths
{
    /// <summary>Per-user app data root: roaming AppData on Windows, ~/.config on Linux.</summary>
    public static string DataDirectory { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "NodeScope");

    /// <summary>
    /// Log directory. Decision 19: the client logs to a rolling file here and nowhere else.
    /// </summary>
    public static string LogDirectory { get; } = Path.Combine(DataDirectory, "logs");

    /// <summary>Non-secret client settings (appliance URL).</summary>
    public static string SettingsFile { get; } = Path.Combine(DataDirectory, "settings.json");

    /// <summary>
    /// The token vault (Decision 17): DPAPI-wrapped on Windows, 0600 plain file elsewhere.
    /// Distinct names so switching OSes can never misread one format as the other.
    /// </summary>
    public static string VaultFile { get; } = Path.Combine(
        DataDirectory, OperatingSystem.IsWindows() ? "vault.dpapi" : "vault.json");
}
