namespace NodeScope.Modules.Inventory.Application.BuildingModels;

/// <summary>BuildingModel persistence (Node's <c>BuildingModelsRepository</c>).</summary>
public interface IBuildingModelRepository
{
    /// <summary>True when the BUILDING property carries a model (any version).</summary>
    public Task<bool> ExistsForPropertyAsync(
        string organizationId,
        string propertyId,
        CancellationToken cancellationToken);
}
