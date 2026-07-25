namespace NodeScope.Desktop.Auth;

/// <summary>What the vault protects: which appliance the token belongs to, and the token.</summary>
internal sealed record VaultEntry(Uri ServerUrl, string Token);

/// <summary>
/// Decision 17: OS-protected token storage behind an interface (the Electron
/// <c>safeStorage</c> replacement). DPAPI on Windows today; libsecret/Keychain slot in
/// here if/when those clients ship. A vault that cannot be read (tampered, key rotated,
/// wrong OS user) returns null - the cost is one re-login, never a crash.
/// </summary>
internal interface ITokenVault
{
    public VaultEntry? Load();

    public void Save(VaultEntry entry);

    public void Clear();
}
