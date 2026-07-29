using NodeScope.Backup;
using Xunit;

namespace NodeScope.Backup.Tests;

public sealed class OffsiteBackupServiceTests : IDisposable
{
    private readonly string _root = Path.Combine(
        Path.GetTempPath(),
        $"nodescope-offsite-tests-{Guid.NewGuid():N}");

    public OffsiteBackupServiceTests() => Directory.CreateDirectory(_root);

    public void Dispose()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }

    [Fact]
    public async Task Push_list_pull_round_trip_and_retention_work_together()
    {
        var identity = OffsiteIdentity.Generate();
        var store = new MemoryBackupStore();
        var service = new OffsiteBackupService(Options(identity, keep: 2), store);
        var names = new[]
        {
            "nodescope-20260728-010201",
            "nodescope-20260728-010202",
            "nodescope-20260728-010203",
        };
        foreach (var name in names)
        {
            await service.PushAsync(CreateBundle(name), CancellationToken.None);
        }

        var listed = await service.ListAsync(CancellationToken.None);
        Assert.Equal(names[1..], listed.Select(service.DisplayName));

        var destination = Path.Combine(_root, "pulled");
        await service.PullAsync(
            names[^1],
            destination,
            identity.PrivateKey,
            CancellationToken.None);
        Assert.Equal("database", await File.ReadAllTextAsync(Path.Combine(destination, "db.sql.gz")));
        Assert.Equal("blobs", await File.ReadAllTextAsync(Path.Combine(destination, "blobs.tar.gz")));
    }

    [Fact]
    public async Task Database_only_push_does_not_recover_unshipped_blobs()
    {
        var identity = OffsiteIdentity.Generate();
        var store = new MemoryBackupStore();
        var service = new OffsiteBackupService(
            Options(identity, keep: 7) with { IncludeBlobs = false },
            store);
        const string name = "nodescope-20260728-020101";
        await service.PushAsync(CreateBundle(name), CancellationToken.None);

        var destination = Path.Combine(_root, "database-only");
        await service.PullAsync(name, destination, identity.PrivateKey, CancellationToken.None);

        Assert.True(File.Exists(Path.Combine(destination, "db.sql.gz")));
        Assert.False(File.Exists(Path.Combine(destination, "blobs.tar.gz")));
    }

    [Fact]
    public async Task Wrong_identity_leaves_no_destination_or_partial_directory()
    {
        var identity = OffsiteIdentity.Generate();
        var store = new MemoryBackupStore();
        var service = new OffsiteBackupService(Options(identity, keep: 7), store);
        const string name = "nodescope-20260728-030101";
        await service.PushAsync(CreateBundle(name), CancellationToken.None);
        var destination = Path.Combine(_root, "wrong-key");

        await Assert.ThrowsAsync<System.Security.Cryptography.CryptographicException>(() =>
            service.PullAsync(
                name,
                destination,
                OffsiteIdentity.Generate().PrivateKey,
                CancellationToken.None));

        Assert.False(Directory.Exists(destination));
        Assert.Empty(Directory.GetDirectories(_root, ".wrong-key.partial-*"));
    }

    private static OffsiteOptions Options(OffsiteIdentity identity, int keep) =>
        new(
            identity.PublicKey,
            "http://unused",
            "us-east-1",
            "offsite",
            "access",
            "secret",
            "nodescope",
            keep,
            IncludeBlobs: true);

    private string CreateBundle(string name)
    {
        var bundle = Path.Combine(_root, name);
        Directory.CreateDirectory(bundle);
        File.WriteAllText(Path.Combine(bundle, "manifest.txt"), "manifest");
        File.WriteAllText(Path.Combine(bundle, "db.sql.gz"), "database");
        File.WriteAllText(Path.Combine(bundle, "blobs.tar.gz"), "blobs");
        return bundle;
    }

    private sealed class MemoryBackupStore : IBackupStore
    {
        private readonly Dictionary<string, byte[]> _objects = new(StringComparer.Ordinal);

        public async Task UploadAsync(
            string key,
            string filePath,
            CancellationToken cancellationToken)
        {
            _objects[key] = await File.ReadAllBytesAsync(filePath, cancellationToken);
        }

        public async Task ReadAsync(
            string key,
            Func<Stream, CancellationToken, Task> reader,
            CancellationToken cancellationToken)
        {
            await using var stream = new MemoryStream(_objects[key], writable: false);
            await reader(stream, cancellationToken);
        }

        public Task<IReadOnlyList<StoredBackup>> ListAsync(
            string prefix,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            IReadOnlyList<StoredBackup> objects = _objects
                .Where(pair => pair.Key.StartsWith(prefix, StringComparison.Ordinal))
                .Select(pair => new StoredBackup(
                    pair.Key,
                    pair.Value.LongLength,
                    DateTimeOffset.UnixEpoch))
                .ToArray();
            return Task.FromResult(objects);
        }

        public Task DeleteAsync(string key, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            _objects.Remove(key);
            return Task.CompletedTask;
        }
    }
}
