using System.Text;
using NodeScope.Platform.Storage;
using Xunit;

namespace NodeScope.Platform.Tests;

/// <summary>
/// The fs storage driver is the single-node appliance default (STORAGE_DRIVER=fs) and has
/// no contract coverage (the suite's stack runs MinIO), so these pin its semantics against
/// the Node FsStorageBackend it mirrors: atomic tmp-rename puts, throw-on-missing get,
/// tolerant delete, and the traversal-guarded key resolution.
/// </summary>
public sealed class FsObjectStorageTests : IDisposable
{
    private readonly string _root;
    private readonly FsObjectStorage _storage;

    public FsObjectStorageTests()
    {
        _root = Path.Combine(Path.GetTempPath(), $"nodescope-fs-tests-{Guid.NewGuid():N}");
        _storage = new FsObjectStorage(new FsStorageOptions(_root));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }

    private static MemoryStream Content(string text) => new(Encoding.UTF8.GetBytes(text));

    private async Task<string> ReadBackAsync(string key)
    {
        var stream = await _storage.GetAsync(key, CancellationToken.None);
        await using (stream.ConfigureAwait(false))
        {
            using var reader = new StreamReader(stream);
            return await reader.ReadToEndAsync();
        }
    }

    [Fact]
    public async Task Put_then_get_roundtrips_and_creates_nested_directories()
    {
        await _storage.PutAsync("org/o1/building/p1/v1.ifc", Content("model-bytes"), "application/octet-stream", CancellationToken.None);

        Assert.Equal("model-bytes", await ReadBackAsync("org/o1/building/p1/v1.ifc"));
        Assert.True(await _storage.ExistsAsync("org/o1/building/p1/v1.ifc", CancellationToken.None));
    }

    [Fact]
    public async Task Put_overwrites_an_existing_object()
    {
        await _storage.PutAsync("k.bin", Content("first"), "application/octet-stream", CancellationToken.None);
        await _storage.PutAsync("k.bin", Content("second"), "application/octet-stream", CancellationToken.None);

        Assert.Equal("second", await ReadBackAsync("k.bin"));
    }

    [Fact]
    public async Task Put_leaves_no_temp_file_behind()
    {
        await _storage.PutAsync("a/b.png", Content("x"), "image/png", CancellationToken.None);

        var files = Directory.GetFiles(_root, "*", SearchOption.AllDirectories);
        Assert.Single(files);
        Assert.EndsWith($"a{Path.DirectorySeparatorChar}b.png", files[0], StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_failed_put_cleans_its_temp_file_and_keeps_the_previous_object()
    {
        await _storage.PutAsync("k.bin", Content("intact"), "application/octet-stream", CancellationToken.None);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            _storage.PutAsync("k.bin", new ThrowingStream(), "application/octet-stream", CancellationToken.None));

        Assert.Equal("intact", await ReadBackAsync("k.bin"));
        Assert.Single(Directory.GetFiles(_root, "*", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Get_of_a_missing_key_throws_FileNotFound()
    {
        await Assert.ThrowsAsync<FileNotFoundException>(() => _storage.GetAsync("missing/key.png", CancellationToken.None));
    }

    [Fact]
    public async Task Delete_removes_the_object_and_tolerates_a_missing_key()
    {
        await _storage.PutAsync("k.bin", Content("x"), "application/octet-stream", CancellationToken.None);

        await _storage.DeleteAsync("k.bin", CancellationToken.None);
        Assert.False(await _storage.ExistsAsync("k.bin", CancellationToken.None));

        // Both a missing file and a missing parent directory succeed silently.
        await _storage.DeleteAsync("k.bin", CancellationToken.None);
        await _storage.DeleteAsync("never/existed.bin", CancellationToken.None);
    }

    [Fact]
    public async Task Exists_is_false_before_any_write_creates_the_root()
    {
        Assert.False(await _storage.ExistsAsync("k.bin", CancellationToken.None));
    }

    [Theory]
    [InlineData("../outside.bin")]
    [InlineData("a/../../outside.bin")]
    [InlineData("/absolute.bin")]
    [InlineData("a//b.bin")]
    [InlineData("a/./b.bin")]
    [InlineData("nul\0byte.bin")]
    public async Task Traversal_and_malformed_keys_are_rejected_on_every_operation(string key)
    {
        await Assert.ThrowsAsync<ArgumentException>(() => _storage.PutAsync(key, Content("x"), "application/octet-stream", CancellationToken.None));
        await Assert.ThrowsAsync<ArgumentException>(() => _storage.GetAsync(key, CancellationToken.None));
        await Assert.ThrowsAsync<ArgumentException>(() => _storage.DeleteAsync(key, CancellationToken.None));
        await Assert.ThrowsAsync<ArgumentException>(() => _storage.ExistsAsync(key, CancellationToken.None));
    }

    /// <summary>A stream that fails mid-copy, simulating a dropped upload.</summary>
    private sealed class ThrowingStream : Stream
    {
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public override int Read(byte[] buffer, int offset, int count) =>
            throw new InvalidOperationException("simulated upload failure");

        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
