using System.Formats.Tar;
using System.Text;
using NodeScope.Backup;
using Xunit;

namespace NodeScope.Backup.Tests;

public sealed class BundleArchiveTests : IDisposable
{
    private readonly string _root = Path.Combine(
        Path.GetTempPath(),
        $"nodescope-bundle-tests-{Guid.NewGuid():N}");

    public BundleArchiveTests() => Directory.CreateDirectory(_root);

    public void Dispose()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }

    [Fact]
    public async Task Pack_and_extract_round_trip_all_bundle_files()
    {
        var bundle = CreateBundle("nodescope-20260728-010203");
        await using var archive = new MemoryStream();
        await BundleArchive.PackAsync(bundle, archive, includeBlobs: true, CancellationToken.None);

        archive.Position = 0;
        var destination = Path.Combine(_root, "restored");
        await BundleArchive.ExtractAsync(archive, destination, CancellationToken.None);

        Assert.Equal("manifest", await File.ReadAllTextAsync(Path.Combine(destination, "manifest.txt")));
        Assert.Equal("database", await File.ReadAllTextAsync(Path.Combine(destination, "db.sql.gz")));
        Assert.Equal("blobs", await File.ReadAllTextAsync(Path.Combine(destination, "blobs.tar.gz")));
    }

    [Fact]
    public async Task Database_only_archive_omits_blobs()
    {
        var bundle = CreateBundle("nodescope-20260728-010204");
        await using var archive = new MemoryStream();
        await BundleArchive.PackAsync(bundle, archive, includeBlobs: false, CancellationToken.None);

        archive.Position = 0;
        var destination = Path.Combine(_root, "database-only");
        await BundleArchive.ExtractAsync(archive, destination, CancellationToken.None);

        Assert.True(File.Exists(Path.Combine(destination, "db.sql.gz")));
        Assert.False(File.Exists(Path.Combine(destination, "blobs.tar.gz")));
    }

    [Fact]
    public async Task Extract_rejects_traversal_without_writing_outside_the_stage()
    {
        await using var archive = new MemoryStream();
        await using (var writer = new TarWriter(archive, leaveOpen: true))
        {
            var entry = new PaxTarEntry(TarEntryType.RegularFile, "../outside")
            {
                DataStream = new MemoryStream(Encoding.UTF8.GetBytes("escape")),
            };
            await writer.WriteEntryAsync(entry, CancellationToken.None);
        }

        archive.Position = 0;
        var destination = Path.Combine(_root, "malicious");
        await Assert.ThrowsAsync<InvalidDataException>(() =>
            BundleArchive.ExtractAsync(archive, destination, CancellationToken.None));
        Assert.False(File.Exists(Path.Combine(_root, "outside")));
        Assert.False(Directory.Exists(destination));
    }

    [Fact]
    public async Task Extract_refuses_to_overwrite_an_existing_destination()
    {
        var destination = Path.Combine(_root, "existing");
        Directory.CreateDirectory(destination);

        await Assert.ThrowsAsync<IOException>(() =>
            BundleArchive.ExtractAsync(
                new MemoryStream(),
                destination,
                CancellationToken.None));
    }

    private string CreateBundle(string name)
    {
        var bundle = Path.Combine(_root, name);
        Directory.CreateDirectory(bundle);
        File.WriteAllText(Path.Combine(bundle, "manifest.txt"), "manifest");
        File.WriteAllText(Path.Combine(bundle, "db.sql.gz"), "database");
        File.WriteAllText(Path.Combine(bundle, "blobs.tar.gz"), "blobs");
        return bundle;
    }
}
