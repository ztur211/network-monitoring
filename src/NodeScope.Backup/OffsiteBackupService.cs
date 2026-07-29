using System.Security.Cryptography;

namespace NodeScope.Backup;

internal sealed class OffsiteBackupService
{
    private const string Extension = ".nsob";
    private readonly OffsiteOptions _options;
    private readonly IBackupStore _store;

    public OffsiteBackupService(OffsiteOptions options, IBackupStore store)
    {
        _options = options;
        _store = store;
    }

    public async Task<string> PushAsync(string bundleDirectory, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(bundleDirectory);
        if (string.IsNullOrWhiteSpace(_options.PublicKey))
        {
            throw new InvalidOperationException("OFFSITE_BACKUP_PUBKEY is required to push a backup.");
        }

        var fullBundle = Path.GetFullPath(bundleDirectory);
        var name = Path.GetFileName(fullBundle);
        ValidateBackupName(name);

        var encryptedFile = Path.Combine(
            Path.GetTempPath(),
            $"nodescope-offsite-{Guid.NewGuid():N}{Extension}");
        try
        {
            using var publicKey = CreatePublicKey(_options.PublicKey);
            await using (var output = new FileStream(
                encryptedFile,
                PrivateFile.CreateWriteOptions()))
            await using (var encrypting = await BackupCryptography.FrameEncryptingStream.CreateAsync(
                output,
                publicKey,
                leaveOpen: true,
                cancellationToken))
            {
                await BundleArchive.PackAsync(
                    fullBundle,
                    encrypting,
                    _options.IncludeBlobs,
                    cancellationToken);
                await encrypting.CompleteAsync(cancellationToken);
            }

            var key = ObjectKey(name);
            await _store.UploadAsync(key, encryptedFile, cancellationToken);
            await PruneAsync(cancellationToken);
            return key;
        }
        finally
        {
            File.Delete(encryptedFile);
        }
    }

    public async Task PullAsync(
        string name,
        string destinationDirectory,
        string privateKey,
        CancellationToken cancellationToken)
    {
        ValidateBackupName(name);
        ArgumentException.ThrowIfNullOrWhiteSpace(destinationDirectory);
        ArgumentException.ThrowIfNullOrWhiteSpace(privateKey);

        var clearTar = Path.Combine(
            Path.GetTempPath(),
            $"nodescope-offsite-{Guid.NewGuid():N}.tar");
        try
        {
            using var rsa = CreatePrivateKey(privateKey);
            await _store.ReadAsync(
                ObjectKey(name),
                async (encrypted, readCancellationToken) =>
                {
                    await using var clear = new FileStream(
                        clearTar,
                        PrivateFile.CreateWriteOptions());
                    await BackupCryptography.DecryptAsync(
                        encrypted,
                        clear,
                        rsa,
                        readCancellationToken);
                },
                cancellationToken);

            await using var archive = new FileStream(
                clearTar,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                bufferSize: 128 * 1024,
                FileOptions.Asynchronous | FileOptions.SequentialScan);
            await BundleArchive.ExtractAsync(archive, destinationDirectory, cancellationToken);
        }
        finally
        {
            File.Delete(clearTar);
        }
    }

    public async Task<IReadOnlyList<StoredBackup>> ListAsync(CancellationToken cancellationToken)
    {
        var prefix = PrefixWithSlash();
        var objects = await _store.ListAsync(prefix, cancellationToken);
        return objects
            .Where(item => item.Key.StartsWith(prefix, StringComparison.Ordinal)
                && item.Key.EndsWith(Extension, StringComparison.Ordinal))
            .OrderBy(item => item.Key, StringComparer.Ordinal)
            .ToArray();
    }

    public string DisplayName(StoredBackup backup)
    {
        var prefix = PrefixWithSlash();
        return backup.Key[prefix.Length..^Extension.Length];
    }

    private async Task PruneAsync(CancellationToken cancellationToken)
    {
        var backups = await ListAsync(cancellationToken);
        foreach (var stale in backups.Take(Math.Max(0, backups.Count - _options.Keep)))
        {
            await _store.DeleteAsync(stale.Key, cancellationToken);
        }
    }

    private string ObjectKey(string name) => $"{PrefixWithSlash()}{name}{Extension}";

    private string PrefixWithSlash() => $"{_options.Prefix.Trim('/')}/";

    private static void ValidateBackupName(string name)
    {
        if (!name.StartsWith("nodescope-", StringComparison.Ordinal)
            || name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0
            || name.Contains('/', StringComparison.Ordinal)
            || name.Contains('\\', StringComparison.Ordinal))
        {
            throw new ArgumentException("The backup name must be a nodescope-* bundle name.", nameof(name));
        }
    }

    private static RSA CreatePublicKey(string encoded)
    {
        var rsa = RSA.Create();
        try
        {
            rsa.ImportSubjectPublicKeyInfo(Convert.FromBase64String(encoded), out _);
            return rsa;
        }
        catch
        {
            rsa.Dispose();
            throw;
        }
    }

    private static RSA CreatePrivateKey(string encoded)
    {
        var rsa = RSA.Create();
        try
        {
            rsa.ImportPkcs8PrivateKey(Convert.FromBase64String(encoded), out _);
            return rsa;
        }
        catch
        {
            rsa.Dispose();
            throw;
        }
    }
}
