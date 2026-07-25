using System.Runtime.Versioning;
using System.Text.Json;

namespace NodeScope.Desktop.Auth;

/// <summary>
/// Non-Windows vault: plain JSON with 0600 permissions - the same protection level as
/// ~/.ssh keys, and what the Linux dev loop (WSL2) uses today. Decision 17 slots a
/// libsecret/Keychain implementation behind <see cref="ITokenVault"/> if/when Linux or
/// macOS clients actually ship to customers.
/// </summary>
[UnsupportedOSPlatform("windows")]
internal sealed class PlainFileTokenVault(string path) : ITokenVault
{
    public VaultEntry? Load()
    {
        try
        {
            return JsonSerializer.Deserialize<VaultEntry>(File.ReadAllBytes(path));
        }
        catch (Exception failure) when (failure is IOException or UnauthorizedAccessException or JsonException)
        {
            return null;
        }
    }

    public void Save(VaultEntry entry)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);

        // Create-then-tighten would leave a readable window; create with the mode instead.
        var options = new FileStreamOptions
        {
            Mode = FileMode.Create,
            Access = FileAccess.Write,
            UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite,
        };
        using var stream = new FileStream(path, options);
        JsonSerializer.Serialize(stream, entry);

        // An entry that predates a Save keeps its old mode; enforce on every write.
        File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
    }

    public void Clear() => File.Delete(path);
}
