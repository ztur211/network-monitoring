using NodeScope.Modules.Inventory.Domain;

namespace NodeScope.Modules.Inventory.Application.BuildingModels;

/// <summary>BuildingModel persistence (Node's <c>BuildingModelsRepository</c>).</summary>
public interface IBuildingModelRepository
{
    /// <summary>True when the BUILDING property carries a model (any version).</summary>
    public Task<bool> ExistsForPropertyAsync(
        string organizationId,
        string propertyId,
        CancellationToken cancellationToken);

    public Task<BuildingModelRecord?> FindByPropertyAsync(
        string organizationId,
        string propertyId,
        CancellationToken cancellationToken);

    public Task<BuildingModelRecord> CreateModelAsync(
        string organizationId,
        string propertyId,
        string name,
        CancellationToken cancellationToken);

    /// <summary>Newest first.</summary>
    public Task<IReadOnlyList<BuildingModelVersionRecord>> ListVersionsAsync(
        string organizationId,
        string buildingModelId,
        CancellationToken cancellationToken);

    public Task<BuildingModelVersionRecord?> FindVersionAsync(
        string organizationId,
        string versionId,
        CancellationToken cancellationToken);

    /// <summary>One past the highest version number recorded for the model.</summary>
    public Task<int> NextVersionNumberAsync(
        string organizationId,
        string buildingModelId,
        CancellationToken cancellationToken);

    public Task<BuildingModelVersionRecord> CreateVersionAsync(
        NewBuildingModelVersion version,
        CancellationToken cancellationToken);

    /// <summary>Optimistic repoint of the active version; false on a version conflict.</summary>
    public Task<bool> SetActiveVersionAsync(
        string organizationId,
        string modelId,
        string versionId,
        int expectedVersion,
        CancellationToken cancellationToken);

    /// <summary>Optimistic georeference write (null clears); false on a version conflict.</summary>
    public Task<bool> SetGeoreferenceAsync(
        string organizationId,
        string modelId,
        ModelGeoreference? georeference,
        int expectedVersion,
        CancellationToken cancellationToken);

    public Task DeleteVersionAsync(string organizationId, string versionId, CancellationToken cancellationToken);
}
