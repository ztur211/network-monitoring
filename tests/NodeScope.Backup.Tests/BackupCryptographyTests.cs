using System.Security.Cryptography;
using System.Text;
using NodeScope.Backup;
using Xunit;

namespace NodeScope.Backup.Tests;

public sealed class BackupCryptographyTests
{
    private static readonly Lazy<OffsiteIdentity> Identity = new(OffsiteIdentity.Generate);

    [Fact]
    public async Task Round_trip_preserves_empty_small_and_multiframe_payloads()
    {
        var payloads = new[]
        {
            Array.Empty<byte>(),
            Encoding.UTF8.GetBytes("node scope backup"),
            Enumerable.Range(0, (3 * 1024 * 1024) + 17)
                .Select(index => checked((byte)(index % 251)))
                .ToArray(),
        };

        foreach (var payload in payloads)
        {
            var encrypted = await EncryptAsync(payload, Identity.Value);
            var decrypted = await DecryptAsync(encrypted, Identity.Value);
            Assert.Equal(payload, decrypted);
        }
    }

    [Fact]
    public async Task Tampering_with_ciphertext_is_detected()
    {
        var encrypted = await EncryptAsync(
            Encoding.UTF8.GetBytes("content that must be authenticated"),
            Identity.Value);
        encrypted[^38] ^= 0x40;

        using var privateKey = Identity.Value.CreatePrivateKey();
        await Assert.ThrowsAsync<CryptographicException>(async () =>
        {
            await using var input = new MemoryStream(encrypted);
            await using var output = new MemoryStream();
            await BackupCryptography.DecryptAsync(
                input,
                output,
                privateKey,
                CancellationToken.None);
        });
    }

    [Fact]
    public async Task Wrong_recovery_identity_is_rejected()
    {
        var encrypted = await EncryptAsync(
            Encoding.UTF8.GetBytes("private"),
            Identity.Value);
        var wrongIdentity = OffsiteIdentity.Generate();

        using var privateKey = wrongIdentity.CreatePrivateKey();
        await Assert.ThrowsAsync<CryptographicException>(async () =>
        {
            await using var input = new MemoryStream(encrypted);
            await using var output = new MemoryStream();
            await BackupCryptography.DecryptAsync(
                input,
                output,
                privateKey,
                CancellationToken.None);
        });
    }

    [Fact]
    public async Task Truncated_ciphertext_is_rejected()
    {
        var encrypted = await EncryptAsync(
            Encoding.UTF8.GetBytes("must have an authenticated final frame"),
            Identity.Value);
        Array.Resize(ref encrypted, encrypted.Length - 4);

        using var privateKey = Identity.Value.CreatePrivateKey();
        await Assert.ThrowsAsync<InvalidDataException>(async () =>
        {
            await using var input = new MemoryStream(encrypted);
            await using var output = new MemoryStream();
            await BackupCryptography.DecryptAsync(
                input,
                output,
                privateKey,
                CancellationToken.None);
        });
    }

    private static async Task<byte[]> EncryptAsync(byte[] payload, OffsiteIdentity identity)
    {
        using var publicKey = identity.CreatePublicKey();
        await using var input = new MemoryStream(payload);
        await using var output = new MemoryStream();
        await BackupCryptography.EncryptAsync(
            input,
            output,
            publicKey,
            CancellationToken.None);
        return output.ToArray();
    }

    private static async Task<byte[]> DecryptAsync(byte[] payload, OffsiteIdentity identity)
    {
        using var privateKey = identity.CreatePrivateKey();
        await using var input = new MemoryStream(payload);
        await using var output = new MemoryStream();
        await BackupCryptography.DecryptAsync(
            input,
            output,
            privateKey,
            CancellationToken.None);
        return output.ToArray();
    }
}
