using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text.Json;

namespace NodeScope.Desktop.Auth;

/// <summary>
/// Windows vault: the JSON entry DPAPI-protected under the current user's key
/// (<see cref="DataProtectionScope.CurrentUser"/>), so another local user - or the same
/// user on another machine - cannot read the token file.
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class DpapiTokenVault(string path) : ITokenVault
{
    public VaultEntry? Load()
    {
        try
        {
            var wrapped = File.ReadAllBytes(path);
            var json = ProtectedData.Unprotect(wrapped, optionalEntropy: null, DataProtectionScope.CurrentUser);
            return JsonSerializer.Deserialize<VaultEntry>(json);
        }
        catch (Exception failure) when (
            failure is IOException or UnauthorizedAccessException or CryptographicException or JsonException)
        {
            return null;
        }
    }

    public void Save(VaultEntry entry)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var json = JsonSerializer.SerializeToUtf8Bytes(entry);
        File.WriteAllBytes(path, ProtectedData.Protect(json, optionalEntropy: null, DataProtectionScope.CurrentUser));
    }

    public void Clear() => File.Delete(path);
}
