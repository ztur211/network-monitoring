using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Inventory.Application.BuildingModels;

namespace NodeScope.Modules.Inventory.Infrastructure.Persistence;

internal sealed class BuildingModelRepository : IBuildingModelRepository
{
    private readonly InventoryDbContext _db;

    public BuildingModelRepository(InventoryDbContext db)
    {
        _db = db;
    }

    public Task<bool> ExistsForPropertyAsync(
        string organizationId,
        string propertyId,
        CancellationToken cancellationToken) =>
        _db.BuildingModels.AnyAsync(
            m => m.OrganizationId == organizationId && m.PropertyId == propertyId,
            cancellationToken);

    public async Task<BuildingModelRecord?> FindByPropertyAsync(
        string organizationId,
        string propertyId,
        CancellationToken cancellationToken)
    {
        var row = await _db.BuildingModels
            .AsNoTracking()
            .SingleOrDefaultAsync(
                m => m.OrganizationId == organizationId && m.PropertyId == propertyId, cancellationToken);
        return row is null ? null : ToRecord(row);
    }

    public async Task<BuildingModelRecord> CreateModelAsync(
        string organizationId,
        string propertyId,
        string name,
        CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var row = new BuildingModelRow
        {
            Id = Guid.NewGuid().ToString(),
            OrganizationId = organizationId,
            PropertyId = propertyId,
            Name = name,
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.BuildingModels.Add(row);
        await _db.SaveChangesAsync(cancellationToken);
        return ToRecord(row);
    }

    public async Task<IReadOnlyList<BuildingModelVersionRecord>> ListVersionsAsync(
        string organizationId,
        string buildingModelId,
        CancellationToken cancellationToken)
    {
        var rows = await _db.BuildingModelVersions
            .Where(v => v.OrganizationId == organizationId && v.BuildingModelId == buildingModelId)
            .OrderByDescending(v => v.VersionNumber)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
        return [.. rows.Select(ToRecord)];
    }

    public async Task<BuildingModelVersionRecord?> FindVersionAsync(
        string organizationId,
        string versionId,
        CancellationToken cancellationToken)
    {
        var row = await _db.BuildingModelVersions
            .AsNoTracking()
            .SingleOrDefaultAsync(
                v => v.Id == versionId && v.OrganizationId == organizationId, cancellationToken);
        return row is null ? null : ToRecord(row);
    }

    public async Task<int> NextVersionNumberAsync(
        string organizationId,
        string buildingModelId,
        CancellationToken cancellationToken)
    {
        var highest = await _db.BuildingModelVersions
            .Where(v => v.OrganizationId == organizationId && v.BuildingModelId == buildingModelId)
            .MaxAsync(v => (int?)v.VersionNumber, cancellationToken);
        return (highest ?? 0) + 1;
    }

    public async Task<BuildingModelVersionRecord> CreateVersionAsync(
        NewBuildingModelVersion version,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(version);
        var row = new BuildingModelVersionRow
        {
            Id = version.Id,
            OrganizationId = version.OrganizationId,
            BuildingModelId = version.BuildingModelId,
            VersionNumber = version.VersionNumber,
            StorageKey = version.StorageKey,
            FileName = version.FileName,
            ContentHash = version.ContentHash,
            SizeBytes = version.SizeBytes,
            Units = version.Units,
            UploadedByMemberId = version.UploadedByMemberId,
            CreatedAt = DateTime.UtcNow,
        };
        _db.BuildingModelVersions.Add(row);
        await _db.SaveChangesAsync(cancellationToken);
        return ToRecord(row);
    }

    public async Task<bool> SetActiveVersionAsync(
        string organizationId,
        string modelId,
        string versionId,
        int expectedVersion,
        CancellationToken cancellationToken) =>
        await _db.BuildingModels
            .Where(m => m.Id == modelId && m.OrganizationId == organizationId && m.Version == expectedVersion)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(m => m.ActiveVersionId, versionId)
                    .SetProperty(m => m.Version, m => m.Version + 1)
                    .SetProperty(m => m.UpdatedAt, DateTime.UtcNow),
                cancellationToken) > 0;

    public Task DeleteVersionAsync(string organizationId, string versionId, CancellationToken cancellationToken) =>
        _db.BuildingModelVersions
            .Where(v => v.Id == versionId && v.OrganizationId == organizationId)
            .ExecuteDeleteAsync(cancellationToken);

    private static BuildingModelRecord ToRecord(BuildingModelRow row) => new(
        row.Id, row.OrganizationId, row.PropertyId, row.Name, row.ActiveVersionId, row.Version,
        row.CreatedAt, row.UpdatedAt);

    private static BuildingModelVersionRecord ToRecord(BuildingModelVersionRow row) => new(
        row.Id, row.OrganizationId, row.BuildingModelId, row.VersionNumber, row.StorageKey, row.FileName,
        row.ContentHash, row.SizeBytes, row.Units, row.UploadedByMemberId, row.CreatedAt);
}
