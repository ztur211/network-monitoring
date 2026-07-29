using Amazon;
using Amazon.S3;
using Amazon.S3.Model;
using Amazon.S3.Transfer;

namespace NodeScope.Backup;

internal sealed record StoredBackup(string Key, long Size, DateTimeOffset LastModified);

internal interface IBackupStore
{
    public Task UploadAsync(string key, string filePath, CancellationToken cancellationToken);

    public Task ReadAsync(
        string key,
        Func<Stream, CancellationToken, Task> reader,
        CancellationToken cancellationToken);

    public Task<IReadOnlyList<StoredBackup>> ListAsync(
        string prefix,
        CancellationToken cancellationToken);

    public Task DeleteAsync(string key, CancellationToken cancellationToken);
}

internal sealed class S3BackupStore : IBackupStore, IDisposable
{
    private readonly AmazonS3Client _client;
    private readonly string _bucket;

    public S3BackupStore(OffsiteOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        var config = new AmazonS3Config
        {
            RegionEndpoint = RegionEndpoint.GetBySystemName(options.Region),
            ForcePathStyle = true,
        };
        if (!string.IsNullOrEmpty(options.Endpoint))
        {
            config.ServiceURL = options.Endpoint;
        }

        _client = new AmazonS3Client(options.AccessKey, options.SecretKey, config);
        _bucket = options.Bucket;
    }

    public async Task UploadAsync(
        string key,
        string filePath,
        CancellationToken cancellationToken)
    {
        await using var input = new FileStream(
            filePath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: 128 * 1024,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        using var transfer = new TransferUtility(_client);
        await transfer.UploadAsync(
            new TransferUtilityUploadRequest
            {
                BucketName = _bucket,
                Key = key,
                InputStream = input,
                ContentType = "application/vnd.nodescope.offsite-backup",
                AutoCloseStream = false,
            },
            cancellationToken);
    }

    public async Task ReadAsync(
        string key,
        Func<Stream, CancellationToken, Task> reader,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(reader);
        using var response = await _client.GetObjectAsync(_bucket, key, cancellationToken);
        await reader(response.ResponseStream, cancellationToken);
    }

    public async Task<IReadOnlyList<StoredBackup>> ListAsync(
        string prefix,
        CancellationToken cancellationToken)
    {
        var results = new List<StoredBackup>();
        string? continuationToken = null;
        do
        {
            var response = await _client.ListObjectsV2Async(
                new ListObjectsV2Request
                {
                    BucketName = _bucket,
                    Prefix = prefix,
                    ContinuationToken = continuationToken,
                },
                cancellationToken);
            results.AddRange(response.S3Objects.Select(item =>
                new StoredBackup(
                    item.Key,
                    item.Size ?? 0,
                    new DateTimeOffset(item.LastModified ?? DateTime.UnixEpoch))));
            continuationToken = response.IsTruncated == true ? response.NextContinuationToken : null;
        }
        while (continuationToken is not null);

        return results;
    }

    public Task DeleteAsync(string key, CancellationToken cancellationToken) =>
        _client.DeleteObjectAsync(_bucket, key, cancellationToken);

    public void Dispose() => _client.Dispose();
}
