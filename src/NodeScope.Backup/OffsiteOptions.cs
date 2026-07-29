namespace NodeScope.Backup;

internal sealed record OffsiteOptions(
    string PublicKey,
    string Endpoint,
    string Region,
    string Bucket,
    string AccessKey,
    string SecretKey,
    string Prefix,
    int Keep,
    bool IncludeBlobs)
{
    public static OffsiteOptions FromEnvironment()
    {
        var publicKey = Environment.GetEnvironmentVariable("OFFSITE_BACKUP_PUBKEY")?.Trim() ?? "";
        var endpoint = Environment.GetEnvironmentVariable("OFFSITE_S3_ENDPOINT")?.Trim() ?? "";
        var region = Environment.GetEnvironmentVariable("OFFSITE_S3_REGION")?.Trim();
        var bucket = Environment.GetEnvironmentVariable("OFFSITE_S3_BUCKET")?.Trim() ?? "";
        var accessKey = Environment.GetEnvironmentVariable("OFFSITE_S3_ACCESS_KEY")?.Trim() ?? "";
        var secretKey = Environment.GetEnvironmentVariable("OFFSITE_S3_SECRET_KEY")?.Trim() ?? "";
        var prefix = Environment.GetEnvironmentVariable("OFFSITE_S3_PREFIX")?.Trim().Trim('/');
        var keepRaw = Environment.GetEnvironmentVariable("OFFSITE_KEEP")?.Trim();
        var includeBlobsRaw = Environment.GetEnvironmentVariable("OFFSITE_INCLUDE_BLOBS")?.Trim();

        if (string.IsNullOrWhiteSpace(bucket))
        {
            throw new InvalidOperationException("OFFSITE_S3_BUCKET is required.");
        }

        if (string.IsNullOrWhiteSpace(accessKey) || string.IsNullOrWhiteSpace(secretKey))
        {
            throw new InvalidOperationException(
                "OFFSITE_S3_ACCESS_KEY and OFFSITE_S3_SECRET_KEY are required.");
        }

        var keep = 7;
        if (!string.IsNullOrEmpty(keepRaw)
            && (!int.TryParse(keepRaw, out keep) || keep < 1))
        {
            throw new InvalidOperationException("OFFSITE_KEEP must be a positive integer.");
        }

        var includeBlobs = true;
        if (!string.IsNullOrEmpty(includeBlobsRaw)
            && !bool.TryParse(includeBlobsRaw, out includeBlobs))
        {
            throw new InvalidOperationException("OFFSITE_INCLUDE_BLOBS must be true or false.");
        }

        return new OffsiteOptions(
            publicKey,
            endpoint,
            string.IsNullOrWhiteSpace(region) ? "us-east-1" : region,
            bucket,
            accessKey,
            secretKey,
            string.IsNullOrWhiteSpace(prefix) ? "nodescope" : prefix,
            keep,
            includeBlobs);
    }
}
