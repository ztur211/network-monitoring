using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class BuildingModel
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string PropertyId { get; set; } = null!;

    public string Name { get; set; } = null!;

    public string? ActiveVersionId { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual BuildingModelVersion? ActiveVersion { get; set; }

    public virtual ICollection<BuildingModelVersion> BuildingModelVersion { get; set; } = new List<BuildingModelVersion>();

    public virtual Organization Organization { get; set; } = null!;

    public virtual Property Property { get; set; } = null!;
}
