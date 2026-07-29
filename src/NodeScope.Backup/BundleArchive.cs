using System.Formats.Tar;

namespace NodeScope.Backup;

internal static class BundleArchive
{
    private static readonly string[] RequiredFiles = ["manifest.txt", "db.sql.gz"];
    private const string BlobFile = "blobs.tar.gz";

    public static async Task PackAsync(
        string bundleDirectory,
        Stream output,
        bool includeBlobs,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(bundleDirectory);
        ArgumentNullException.ThrowIfNull(output);

        var fullBundle = Path.GetFullPath(bundleDirectory);
        foreach (var fileName in RequiredFiles)
        {
            RequireRegularFile(Path.Combine(fullBundle, fileName), fileName);
        }

        var blobPath = Path.Combine(fullBundle, BlobFile);
        if (includeBlobs)
        {
            RequireRegularFile(blobPath, BlobFile);
        }

        await using var writer = new TarWriter(output, TarEntryFormat.Pax, leaveOpen: true);
        foreach (var fileName in RequiredFiles)
        {
            await WriteFileAsync(writer, fullBundle, fileName, cancellationToken);
        }

        if (includeBlobs)
        {
            await WriteFileAsync(writer, fullBundle, BlobFile, cancellationToken);
        }
    }

    public static async Task ExtractAsync(
        Stream input,
        string destinationDirectory,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentException.ThrowIfNullOrWhiteSpace(destinationDirectory);

        var destination = Path.GetFullPath(destinationDirectory);
        if (Directory.Exists(destination) || File.Exists(destination))
        {
            throw new IOException($"The restore destination already exists: {destination}");
        }

        var parent = Path.GetDirectoryName(destination)
            ?? throw new InvalidOperationException("The restore destination must have a parent directory.");
        Directory.CreateDirectory(parent);
        var stage = Path.Combine(
            parent,
            $".{Path.GetFileName(destination)}.partial-{Guid.NewGuid():N}");
        Directory.CreateDirectory(stage);

        var extracted = new HashSet<string>(StringComparer.Ordinal);
        try
        {
            await using var reader = new TarReader(input, leaveOpen: true);
            while (await reader.GetNextEntryAsync(copyData: false, cancellationToken) is { } entry)
            {
                if (entry.EntryType is not TarEntryType.RegularFile and not TarEntryType.V7RegularFile)
                {
                    throw new InvalidDataException($"Unsupported archive entry type: {entry.EntryType}.");
                }

                if (!RequiredFiles.Contains(entry.Name, StringComparer.Ordinal)
                    && !string.Equals(entry.Name, BlobFile, StringComparison.Ordinal))
                {
                    throw new InvalidDataException($"Unexpected archive entry: {entry.Name}.");
                }

                if (!extracted.Add(entry.Name))
                {
                    throw new InvalidDataException($"Duplicate archive entry: {entry.Name}.");
                }

                if (entry.DataStream is null)
                {
                    throw new InvalidDataException($"Archive entry has no content: {entry.Name}.");
                }

                var target = Path.Combine(stage, entry.Name);
                await using var targetStream = new FileStream(
                    target,
                    PrivateFile.CreateWriteOptions());
                await entry.DataStream.CopyToAsync(targetStream, cancellationToken);
                await targetStream.FlushAsync(cancellationToken);
            }

            foreach (var fileName in RequiredFiles)
            {
                if (!extracted.Contains(fileName))
                {
                    throw new InvalidDataException($"The archive is missing {fileName}.");
                }
            }

            Directory.Move(stage, destination);
        }
        catch
        {
            if (Directory.Exists(stage))
            {
                Directory.Delete(stage, recursive: true);
            }

            throw;
        }
    }

    private static void RequireRegularFile(string path, string name)
    {
        if (!File.Exists(path))
        {
            throw new FileNotFoundException($"The backup bundle is missing {name}.", path);
        }

        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
        {
            throw new InvalidDataException($"The backup bundle file cannot be a link: {name}.");
        }
    }

    private static async Task WriteFileAsync(
        TarWriter writer,
        string bundleDirectory,
        string fileName,
        CancellationToken cancellationToken)
    {
        await using var content = new FileStream(
            Path.Combine(bundleDirectory, fileName),
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: 128 * 1024,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        var entry = new PaxTarEntry(TarEntryType.RegularFile, fileName)
        {
            DataStream = content,
            ModificationTime = DateTimeOffset.UnixEpoch,
        };
        await writer.WriteEntryAsync(entry, cancellationToken);
    }
}
