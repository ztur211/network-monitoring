using System.Buffers.Binary;
using System.Security.Cryptography;
using Lextm.SharpSnmpLib;
using Lextm.SharpSnmpLib.Security;

namespace NodeScope.Agent;

/// <summary>
/// Which localized-key extension turns an auth digest shorter than 32 bytes into an
/// AES-256 key. AES-256 privacy never made it past expired drafts, and the two drafts
/// extend differently, so gear speaks one or the other.
/// </summary>
internal enum Aes256KeyExtension
{
    /// <summary>
    /// draft-reeder-snmpv3-usm-3desede-00: append password-to-key of the accumulated
    /// key, localized (net-snmp's "AES-256-C"). What real gear predominantly implements.
    /// </summary>
    Reeder,

    /// <summary>
    /// draft-blumenthal-aes-usm-04 section 3.1.2.1: append the auth protocol's plain
    /// hash of the accumulated key (net-snmp's "AES-256").
    /// </summary>
    Blumenthal,
}

/// <summary>
/// AES-256-CFB128 privacy (RFC 3826 mechanics with a 256-bit key) with a correct
/// localized-key extension. SharpSnmpLib's own AES256 provider extends short keys in
/// chunks of <c>DigestLength</c> - which it defines as 12, the truncated HMAC-96
/// authentication-parameter length, not the digest size - re-derived from the original
/// key each round. For SHA-1 auth that coincides with Reeder by accident (only 12 bytes
/// are missing); for MD5 auth the last 4 key bytes come out wrong and no conformant
/// peer can decrypt. Proven against net-snmp's reference implementation of both
/// variants by SnmpV3AesVariantTests (scripts/run-snmpd-aes.sh).
/// </summary>
internal sealed class Aes256PrivacyProvider : IPrivacyProvider
{
    private const int KeyBytes = 32;
    private const int BlockBytes = 16;
    private const int SaltBytes = 8;

    private readonly OctetString _phrase;
    private readonly Aes256KeyExtension _extension;
    private readonly HashAlgorithmName _authHash;

    // authHash is the auth protocol's hash, used only by the Blumenthal extension
    // (Reeder goes through auth's password-to-key).
    public Aes256PrivacyProvider(
        OctetString phrase,
        IAuthenticationProvider auth,
        Aes256KeyExtension extension,
        HashAlgorithmName authHash)
    {
        ArgumentNullException.ThrowIfNull(phrase);
        ArgumentNullException.ThrowIfNull(auth);
        if (auth == DefaultAuthenticationProvider.Instance)
        {
            // Same rule as the library's providers: privacy requires authentication.
            throw new ArgumentException("If authentication is off, then privacy cannot be used.", nameof(auth));
        }

        _phrase = phrase;
        AuthenticationProvider = auth;
        _extension = extension;
        _authHash = authHash;
    }

    public IAuthenticationProvider AuthenticationProvider { get; }

    public ICollection<OctetString>? EngineIds => null;

    /// <summary>Fresh per message: the pipeline reads this once and threads it through
    /// <see cref="SecurityParameters"/> into <see cref="Encrypt"/>.</summary>
    public OctetString Salt => new(RandomNumberGenerator.GetBytes(SaltBytes));

    public byte[] PasswordToKey(byte[] secret, byte[] engineId)
    {
        var localized = AuthenticationProvider.PasswordToKey(secret, engineId);
        if (localized.Length >= KeyBytes)
        {
            return localized[..KeyBytes];
        }

        return _extension == Aes256KeyExtension.Reeder
            ? ExtendReeder(localized, engineId, AuthenticationProvider)
            : ExtendBlumenthal(localized, _authHash);
    }

    public ISnmpData Encrypt(ISnmpData data, SecurityParameters parameters)
    {
        ArgumentNullException.ThrowIfNull(data);
        if (data.TypeCode != SnmpType.Sequence && data is not ISnmpPdu)
        {
            throw new ArgumentException($"Cannot encrypt the scope data: {data.TypeCode}.", nameof(data));
        }

        var (key, iv) = KeyAndIv(parameters);
        return new OctetString(EncryptCfb128(key, iv, data.ToBytes()));
    }

    public ISnmpData Decrypt(ISnmpData data, SecurityParameters parameters)
    {
        ArgumentNullException.ThrowIfNull(data);
        if (data.TypeCode != SnmpType.OctetString)
        {
            throw new ArgumentException($"Cannot decrypt the scope data: {data.TypeCode}.", nameof(data));
        }

        var (key, iv) = KeyAndIv(parameters);
        var decrypted = DecryptCfb128(key, iv, ((OctetString)data).GetRaw());
        return DataFactory.CreateSnmpData(decrypted);
    }

    internal static byte[] ExtendReeder(byte[] localizedKey, byte[] engineId, IAuthenticationProvider auth)
    {
        var key = localizedKey;
        while (key.Length < KeyBytes)
        {
            key = [.. key, .. auth.PasswordToKey(key, engineId)];
        }

        return key[..KeyBytes];
    }

    internal static byte[] ExtendBlumenthal(byte[] localizedKey, HashAlgorithmName authHash)
    {
        var key = localizedKey;
        while (key.Length < KeyBytes)
        {
            key = [.. key, .. CryptographicOperations.HashData(authHash, key)];
        }

        return key[..KeyBytes];
    }

    /// <summary>RFC 3826: IV = engineBoots (4, big-endian) || engineTime (4, big-endian) || salt (8).</summary>
    internal static byte[] BuildIv(int engineBoots, int engineTime, byte[] salt)
    {
        if (salt.Length != SaltBytes)
        {
            throw new ArgumentException($"AES privacy parameters must be {SaltBytes} bytes, got {salt.Length}.", nameof(salt));
        }

        var iv = new byte[BlockBytes];
        BinaryPrimitives.WriteInt32BigEndian(iv, engineBoots);
        BinaryPrimitives.WriteInt32BigEndian(iv.AsSpan(4), engineTime);
        salt.CopyTo(iv, 8);
        return iv;
    }

    internal static byte[] EncryptCfb128(byte[] key, byte[] iv, byte[] plain)
    {
        using var aes = Aes.Create();
        aes.Key = key;
        var padded = aes.EncryptCfb(plain, iv, PaddingMode.Zeros, feedbackSizeInBits: 128);
        // CFB is a stream mode: the peer decrypts a trimmed ciphertext just fine, and
        // net-snmp sends exactly plaintext-length ciphertexts itself.
        return padded.Length == plain.Length ? padded : padded[..plain.Length];
    }

    internal static byte[] DecryptCfb128(byte[] key, byte[] iv, byte[] cipher)
    {
        using var aes = Aes.Create();
        aes.Key = key;
        if (cipher.Length % BlockBytes == 0)
        {
            return aes.DecryptCfb(cipher, iv, PaddingMode.Zeros, feedbackSizeInBits: 128);
        }

        var padded = new byte[(cipher.Length / BlockBytes + 1) * BlockBytes];
        cipher.CopyTo(padded, 0);
        return aes.DecryptCfb(padded, iv, PaddingMode.Zeros, feedbackSizeInBits: 128)[..cipher.Length];
    }

    private (byte[] Key, byte[] Iv) KeyAndIv(SecurityParameters parameters)
    {
        ArgumentNullException.ThrowIfNull(parameters);
        if (parameters.EngineId is null || parameters.EngineBoots is null
            || parameters.EngineTime is null || parameters.PrivacyParameters is null)
        {
            throw new ArgumentException("Invalid security parameters.", nameof(parameters));
        }

        var key = PasswordToKey(_phrase.GetRaw(), parameters.EngineId.GetRaw());
        var iv = BuildIv(
            parameters.EngineBoots.ToInt32(),
            parameters.EngineTime.ToInt32(),
            parameters.PrivacyParameters.GetRaw());
        return (key, iv);
    }
}
