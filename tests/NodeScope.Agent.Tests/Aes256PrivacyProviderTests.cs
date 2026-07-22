using System.Security.Cryptography;
using System.Text;
using Lextm.SharpSnmpLib;
using Lextm.SharpSnmpLib.Security;
using NodeScope.Agent;
using Xunit;

namespace NodeScope.Agent.Tests;

public sealed class Aes256PrivacyProviderTests
{
    private static readonly byte[] EngineId = Convert.FromHexString("80001F888059DC486145A26322");
    private static readonly byte[] Passphrase = Encoding.ASCII.GetBytes("privpass12");

    // Expected keys computed independently from net-snmp keytools.c: RFC 3414 A.2
    // password-to-key + localization, then _kul_extend_reeder / _kul_extend_blumenthal
    // re-implemented over Python hashlib. The first digest-length bytes are the
    // localized key; the tail is where the variants (and SharpSnmpLib's bug) diverge.
    [Theory]
    [InlineData("MD5", "Reeder",
        "92E9863298306ABFA9250C4F54FF245DB0C03ABE3DB564B4DC7265ED57786FEA")]
    [InlineData("MD5", "Blumenthal",
        "92E9863298306ABFA9250C4F54FF245DB7D738FC71D8CA6A36993C212B6AC7DD")]
    [InlineData("SHA", "Reeder",
        "7441E9D9674A55709C82B9C9EB7D2D66DA95A329246A4965E8BC7CF8DAC2A1A6")]
    [InlineData("SHA", "Blumenthal",
        "7441E9D9674A55709C82B9C9EB7D2D66DA95A329AF1E091732ED5F388F49B3AC")]
    [InlineData("SHA256", "Reeder",
        "FBB84E7488FE576266ED2DA748CF9DD4FC49909096187DF5A0BC0A92A37ADF32")]
    [InlineData("SHA256", "Blumenthal",
        "FBB84E7488FE576266ED2DA748CF9DD4FC49909096187DF5A0BC0A92A37ADF32")]
    public void Extends_localized_keys_exactly_as_net_snmp_does(
        string authProtocol, string extension, string expectedKeyHex)
    {
        // The variant arrives as a string because the enum is internal and xUnit
        // requires public theory signatures.
        var provider = new Aes256PrivacyProvider(
            new OctetString("privpass12"),
            Auth(authProtocol),
            Enum.Parse<Aes256KeyExtension>(extension),
            HashName(authProtocol));

        var key = provider.PasswordToKey(Passphrase, EngineId);

        Assert.Equal(expectedKeyHex, Convert.ToHexString(key));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(15)]
    [InlineData(16)]
    [InlineData(17)]
    [InlineData(100)]
    public void Cfb128_round_trips_at_plaintext_length(int plaintextLength)
    {
        var key = RandomNumberGenerator.GetBytes(32);
        var iv = RandomNumberGenerator.GetBytes(16);
        var plain = RandomNumberGenerator.GetBytes(plaintextLength);

        var cipher = Aes256PrivacyProvider.EncryptCfb128(key, iv, plain);

        // The ciphertext must not grow: net-snmp peers send and expect
        // plaintext-length CFB ciphertexts, block-aligned or not.
        Assert.Equal(plaintextLength, cipher.Length);
        Assert.Equal(plain, Aes256PrivacyProvider.DecryptCfb128(key, iv, cipher));
    }

    [Fact]
    public void Iv_is_boots_and_time_big_endian_then_salt()
    {
        var iv = Aes256PrivacyProvider.BuildIv(
            0x01020304, 0x0A0B0C0D, [0xF0, 0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7]);

        Assert.Equal("010203040A0B0C0DF0F1F2F3F4F5F6F7", Convert.ToHexString(iv));
    }

    [Fact]
    public void Refuses_privacy_without_authentication()
    {
        Assert.Throws<ArgumentException>(() => new Aes256PrivacyProvider(
            new OctetString("privpass12"),
            DefaultAuthenticationProvider.Instance,
            Aes256KeyExtension.Reeder,
            HashAlgorithmName.SHA1));
    }

    private static IAuthenticationProvider Auth(string protocol) => protocol switch
    {
#pragma warning disable CS0618 // Obsolete-but-supported, exactly as in SharpSnmpSession.
        "MD5" => new MD5AuthenticationProvider(new OctetString("authpass12")),
        "SHA" => new SHA1AuthenticationProvider(new OctetString("authpass12")),
#pragma warning restore CS0618
        "SHA256" => new SHA256AuthenticationProvider(new OctetString("authpass12")),
        _ => throw new ArgumentOutOfRangeException(nameof(protocol)),
    };

    private static HashAlgorithmName HashName(string protocol) => protocol switch
    {
        "MD5" => HashAlgorithmName.MD5,
        "SHA" => HashAlgorithmName.SHA1,
        "SHA256" => HashAlgorithmName.SHA256,
        _ => throw new ArgumentOutOfRangeException(nameof(protocol)),
    };
}
