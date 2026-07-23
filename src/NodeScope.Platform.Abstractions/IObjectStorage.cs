namespace NodeScope.Platform.Abstractions;

/// <summary>
/// Blob storage for the files the product keeps outside the database (IFC models, BCF
/// archives). One seam, S3-compatible in production (MinIO on the appliance) - Decision 10.
/// </summary>
public interface IObjectStorage
{
    /// <summary>Streams <paramref name="content"/> to <paramref name="key"/>, overwriting it.</summary>
    public Task PutAsync(string key, Stream content, string contentType, CancellationToken cancellationToken);

    /// <summary>Opens the stored object; throws when the key is absent.</summary>
    public Task<Stream> GetAsync(string key, CancellationToken cancellationToken);

    /// <summary>Removes the object; succeeds whether or not it existed.</summary>
    public Task DeleteAsync(string key, CancellationToken cancellationToken);

    public Task<bool> ExistsAsync(string key, CancellationToken cancellationToken);
}

/// <summary>The storage key layout, shared so every producer and consumer agrees on it.</summary>
public static class StorageKeys
{
    public static string BuildingModelVersion(string organizationId, string propertyId, string versionId) =>
        $"org/{organizationId}/building/{propertyId}/{versionId}.ifc";

    /// <summary>
    /// A BCF viewpoint snapshot. The random suffix keeps re-imports of the same topic from
    /// overwriting an existing snapshot before the new import is known to have succeeded.
    /// </summary>
    public static string BcfSnapshot(string organizationId, string topicGuid, string viewpointGuid) =>
        $"org/{organizationId}/bcf/{topicGuid}/{viewpointGuid}-{Guid.NewGuid()}.png";
}
