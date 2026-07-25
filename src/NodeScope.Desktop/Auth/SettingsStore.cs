using System.Text.Json;

namespace NodeScope.Desktop.Auth;

/// <summary>Non-secret client settings; today just which appliance to talk to.</summary>
internal sealed record DesktopSettings(Uri? ApplianceUrl)
{
    public static DesktopSettings Empty { get; } = new((Uri?)null);
}

/// <summary>
/// settings.json in app data. Corrupt or missing settings degrade to
/// <see cref="DesktopSettings.Empty"/> - first-run and broken-file look identical, which
/// is the desired recovery: the sign-in screen simply asks for the URL again.
/// </summary>
internal sealed class SettingsStore(string path)
{
    public DesktopSettings Load()
    {
        try
        {
            return JsonSerializer.Deserialize<DesktopSettings>(File.ReadAllBytes(path)) ?? DesktopSettings.Empty;
        }
        catch (Exception failure) when (failure is IOException or UnauthorizedAccessException or JsonException)
        {
            return DesktopSettings.Empty;
        }
    }

    public void Save(DesktopSettings settings)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, JsonSerializer.SerializeToUtf8Bytes(settings));
    }
}
