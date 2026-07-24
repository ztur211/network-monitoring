using NodeScope.Platform.Abstractions;

namespace NodeScope.Platform.Storage;

/// <summary>
/// Local-filesystem blob storage rooted at a directory - the single-node appliance default
/// (<c>STORAGE_DRIVER=fs</c>), mirroring the Node <c>FsStorageBackend</c>. Writes go to a
/// sibling temp file and land with an atomic rename, so a crash mid-upload never leaves a
/// truncated object under a real key.
/// </summary>
internal sealed class FsObjectStorage(FsStorageOptions options) : IObjectStorage
{
    public async Task PutAsync(string key, Stream content, string contentType, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(content);
        var destination = ResolveKeyPath(key);
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        var temp = $"{destination}.{Guid.NewGuid():N}.tmp";
        try
        {
            var stream = new FileStream(
                temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, bufferSize: 81920, useAsync: true);
            await using (stream.ConfigureAwait(false))
            {
                await content.CopyToAsync(stream, cancellationToken).ConfigureAwait(false);
            }

            File.Move(temp, destination, overwrite: true);
        }
        catch
        {
            File.Delete(temp);
            throw;
        }
    }

    public Task<Stream> GetAsync(string key, CancellationToken cancellationToken)
    {
        var source = ResolveKeyPath(key);
        if (!File.Exists(source))
        {
            throw new FileNotFoundException($"Storage key not found: {key}", source);
        }

        return Task.FromResult<Stream>(new FileStream(
            source, FileMode.Open, FileAccess.Read, FileShare.Read, bufferSize: 81920, useAsync: true));
    }

    public Task DeleteAsync(string key, CancellationToken cancellationToken)
    {
        var path = ResolveKeyPath(key);
        try
        {
            File.Delete(path);
        }
        catch (DirectoryNotFoundException)
        {
            // A missing parent directory means the key never existed; deletion succeeds.
        }

        return Task.CompletedTask;
    }

    public Task<bool> ExistsAsync(string key, CancellationToken cancellationToken) =>
        Task.FromResult(File.Exists(ResolveKeyPath(key)));

    /// <summary>
    /// Maps a storage key to a path strictly inside the root. Keys are internal
    /// (<see cref="StorageKeys"/>), so a traversal attempt is a bug - reject, never resolve.
    /// </summary>
    private string ResolveKeyPath(string key)
    {
        ArgumentNullException.ThrowIfNull(key);
        var segments = key.Split('/');
        if (key.Contains('\0', StringComparison.Ordinal)
            || Path.IsPathRooted(key)
            || Array.Exists(segments, static s => s is "" or "." or ".."))
        {
            throw new ArgumentException("INVALID_STORAGE_KEY", nameof(key));
        }

        var resolved = Path.GetFullPath(Path.Combine([options.Root, .. segments]));
        var rootWithSeparator = Path.GetFullPath(options.Root) + Path.DirectorySeparatorChar;
        return resolved.StartsWith(rootWithSeparator, StringComparison.Ordinal)
            ? resolved
            : throw new ArgumentException("INVALID_STORAGE_KEY", nameof(key));
    }
}

/// <summary>Where fs-mode blobs live (<c>STORAGE_FS_ROOT</c>).</summary>
public sealed record FsStorageOptions(string Root);
