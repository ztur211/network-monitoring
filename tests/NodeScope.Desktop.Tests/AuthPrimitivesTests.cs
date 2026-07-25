using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using NodeScope.Desktop.Auth;
using Xunit;

namespace NodeScope.Desktop.Tests;

public sealed partial class PkceTests
{
    [GeneratedRegex("^[A-Za-z0-9_-]+$")]
    private static partial Regex Base64UrlAlphabet();

    [Fact]
    public void The_verifier_is_86_chars_of_base64url_and_the_challenge_is_its_s256()
    {
        var pair = Pkce.NewPair();

        Assert.Equal(86, pair.Verifier.Length); // 64 bytes, inside RFC 7636's 43..128
        Assert.Matches(Base64UrlAlphabet(), pair.Verifier);
        Assert.Matches(Base64UrlAlphabet(), pair.Challenge);

        var expected = Convert.ToBase64String(SHA256.HashData(Encoding.ASCII.GetBytes(pair.Verifier)))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        Assert.Equal(expected, pair.Challenge);
    }

    [Fact]
    public void Pairs_and_states_are_unique_per_call()
    {
        Assert.NotEqual(Pkce.NewPair().Verifier, Pkce.NewPair().Verifier);
        Assert.NotEqual(Pkce.NewState(), Pkce.NewState());
    }
}

public sealed class DesktopCallbackTests
{
    [Fact]
    public void A_wellformed_callback_parses_with_unescaped_values()
    {
        var parsed = DesktopCallback.Parse(new Uri("nodescope://auth/callback?code=a%2Bb&state=s%20t"));

        Assert.Equal(new ParsedCallback("a+b", "s t"), parsed);
    }

    [Theory]
    [InlineData("https://auth/callback?code=c&state=s")] // wrong scheme
    [InlineData("nodescope://other/callback?code=c&state=s")] // wrong authority
    [InlineData("nodescope://auth/elsewhere?code=c&state=s")] // wrong path
    [InlineData("nodescope://auth/callback?code=c")] // missing state
    [InlineData("nodescope://auth/callback?state=s")] // missing code
    [InlineData("nodescope://auth/callback?code=&state=s")] // empty code
    public void Anything_else_is_rejected(string candidate) =>
        Assert.Null(DesktopCallback.Parse(new Uri(candidate)));
}

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
