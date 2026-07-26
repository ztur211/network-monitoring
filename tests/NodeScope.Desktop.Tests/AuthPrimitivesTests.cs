using NodeScope.Desktop.Auth;
using Xunit;

namespace NodeScope.Desktop.Tests;

public sealed class VaultAndSettingsTests : IDisposable
{
    private readonly DirectoryInfo _scratch = Directory.CreateTempSubdirectory("nodescope-vault-tests-");

    public void Dispose() => _scratch.Delete(recursive: true);

    [Fact]
    public void The_plain_file_vault_round_trips_and_holds_0600()
    {
        if (OperatingSystem.IsWindows())
        {
            return; // Windows uses the DPAPI vault; nothing to assert here
        }

        var path = Path.Combine(_scratch.FullName, "vault.json");
        var vault = new PlainFileTokenVault(path);
        var entry = new VaultEntry(new Uri("https://appliance.local/"), "tok-1");

        vault.Save(entry);

        Assert.Equal(entry, vault.Load());
        Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(path));

        vault.Clear();
        Assert.Null(vault.Load());
    }

    [Fact]
    public void A_corrupt_vault_reads_as_signed_out()
    {
        if (OperatingSystem.IsWindows())
        {
            return;
        }

        var path = Path.Combine(_scratch.FullName, "vault.json");
        File.WriteAllText(path, "{ not json");

        Assert.Null(new PlainFileTokenVault(path).Load());
    }

    [Fact]
    public void Settings_round_trip_and_degrade_to_empty()
    {
        var path = Path.Combine(_scratch.FullName, "settings.json");
        var store = new SettingsStore(path);

        Assert.Equal(DesktopSettings.Empty, store.Load()); // missing file

        store.Save(new DesktopSettings(new Uri("https://appliance.local/")));
        Assert.Equal(new Uri("https://appliance.local/"), store.Load().ApplianceUrl);

        File.WriteAllText(path, "###");
        Assert.Equal(DesktopSettings.Empty, store.Load()); // corrupt file
    }
}
