using System.Net;
using Amazon.S3;
using Amazon.S3.Model;
using Amazon.S3.Transfer;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Platform.Storage;

/// <summary>
/// S3-compatible object storage (MinIO on the appliance, S3 in the cloud) - Decision 10.
/// The bucket is created on first use, matching the Node backend's <c>ensureReady</c>.
/// </summary>
internal sealed class S3ObjectStorage : IObjectStorage
{
    private readonly IAmazonS3 _s3;
    private readonly string _bucket;
    private Task? _bucketReady;

    public S3ObjectStorage(IAmazonS3 s3, S3StorageOptions options)
    {
        _s3 = s3;
        _bucket = options.Bucket;
    }

    /// <summary>
    /// Uploads via the transfer utility (multipart), not <c>PutObject</c>: an upload arrives as
    /// an unseekable request body of unknown length, and PutObject demands a content length it
    /// can only get by buffering the whole object first.
    /// </summary>
    public async Task PutAsync(string key, Stream content, string contentType, CancellationToken cancellationToken)
    {
        await EnsureBucketAsync(cancellationToken);
        using var transfer = new TransferUtility(_s3);
        await transfer.UploadAsync(
            new TransferUtilityUploadRequest
            {
                BucketName = _bucket,
                Key = key,
                InputStream = content,
                ContentType = contentType,
                AutoCloseStream = false,
            },
            cancellationToken);
    }

    public async Task<Stream> GetAsync(string key, CancellationToken cancellationToken)
    {
        var response = await _s3.GetObjectAsync(_bucket, key, cancellationToken);
        return response.ResponseStream;
    }

    public async Task DeleteAsync(string key, CancellationToken cancellationToken) =>
        await _s3.DeleteObjectAsync(_bucket, key, cancellationToken);

    public async Task<bool> ExistsAsync(string key, CancellationToken cancellationToken)
    {
        try
        {
            await _s3.GetObjectMetadataAsync(_bucket, key, cancellationToken);
            return true;
        }
        catch (AmazonS3Exception failure) when (failure.StatusCode == HttpStatusCode.NotFound)
        {
            return false;
        }
    }

    /// <summary>Creates the bucket once per process; concurrent callers await the same attempt.</summary>
    private Task EnsureBucketAsync(CancellationToken cancellationToken) =>
        _bucketReady ??= CreateBucketAsync(cancellationToken);

    private async Task CreateBucketAsync(CancellationToken cancellationToken)
    {
        try
        {
            await _s3.PutBucketAsync(new PutBucketRequest { BucketName = _bucket }, cancellationToken);
        }
        catch (AmazonS3Exception exception) when (
            exception.ErrorCode is "BucketAlreadyOwnedByYou" or "BucketAlreadyExists")
        {
        }
    }
}

/// <summary>Where the object store lives and how to authenticate to it.</summary>
public sealed record S3StorageOptions(
    string Bucket,
    string? Endpoint,
    string Region,
    string AccessKey,
    string SecretKey);
