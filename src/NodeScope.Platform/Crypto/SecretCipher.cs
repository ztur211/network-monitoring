using System.Security.Cryptography;
using System.Text;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Platform.Crypto;

/// <summary>
/// AES-256-GCM over the <c>SECRET_ENCRYPTION_KEY</c> (base64, exactly 32 bytes), blob layout
/// <c>iv(12) | authTag(16) | ciphertext</c> in base64 - byte-compatible with the Node
/// <c>CryptoService</c>, verified by decrypting rows it wrote.
/// </summary>
public sealed class SecretCipher : ISecretCipher, IDisposable
{
    private const int IvLength = 12;
    private const int TagLength = 16;

    private readonly AesGcm _aes;

    public SecretCipher(byte[] key)
    {
        ArgumentNullException.ThrowIfNull(key);
        if (key.Length != 32)
        {
            throw new ArgumentException("SECRET_ENCRYPTION_KEY must be 32 bytes", nameof(key));
        }

        _aes = new AesGcm(key, TagLength);
    }

    /// <summary>Builds a cipher from the base64 env value, failing loudly like the Node boot did.</summary>
    public static SecretCipher FromBase64Key(string? base64Key)
    {
        if (string.IsNullOrEmpty(base64Key))
        {
            throw new InvalidOperationException("SECRET_ENCRYPTION_KEY is required for SNMP");
        }

        var key = Convert.FromBase64String(base64Key);
        return key.Length == 32
            ? new SecretCipher(key)
            : throw new InvalidOperationException($"SECRET_ENCRYPTION_KEY must decode to 32 bytes, got {key.Length}");
    }

    public string Encrypt(string plaintext)
    {
        ArgumentNullException.ThrowIfNull(plaintext);
        var plainBytes = Encoding.UTF8.GetBytes(plaintext);
        var blob = new byte[IvLength + TagLength + plainBytes.Length];
        var iv = blob.AsSpan(0, IvLength);
        var tag = blob.AsSpan(IvLength, TagLength);
        var ciphertext = blob.AsSpan(IvLength + TagLength);
        RandomNumberGenerator.Fill(iv);
        _aes.Encrypt(iv, plainBytes, ciphertext, tag);
        return Convert.ToBase64String(blob);
    }

    public string Decrypt(string blob)
    {
        ArgumentNullException.ThrowIfNull(blob);
        var bytes = Convert.FromBase64String(blob);
        var plain = new byte[bytes.Length - IvLength - TagLength];
        _aes.Decrypt(
            bytes.AsSpan(0, IvLength),
            bytes.AsSpan(IvLength + TagLength),
            bytes.AsSpan(IvLength, TagLength),
            plain);
        return Encoding.UTF8.GetString(plain);
    }

    public void Dispose() => _aes.Dispose();
}
