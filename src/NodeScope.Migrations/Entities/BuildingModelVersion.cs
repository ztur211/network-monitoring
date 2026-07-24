using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class BuildingModelVersion
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string BuildingModelId { get; set; } = null!;

    public int VersionNumber { get; set; }

    public string StorageKey { get; set; } = null!;

    public string FileName { get; set; } = null!;

    public string ContentHash { get; set; } = null!;

    public int SizeBytes { get; set; }

    public string? Units { get; set; }

    public string? UploadedByMemberId { get; set; }

    public DateTime CreatedAt { get; set; }

    public virtual BuildingModel? BuildingModel { get; set; }

    public virtual BuildingModel BuildingModelNavigation { get; set; } = null!;

    public virtual Organization Organization { get; set; } = null!;
}
