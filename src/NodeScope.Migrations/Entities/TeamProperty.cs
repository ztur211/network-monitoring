using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class TeamProperty
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string TeamId { get; set; } = null!;

    public string PropertyId { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public virtual Organization Organization { get; set; } = null!;

    public virtual Property Property { get; set; } = null!;

    public virtual Team Team { get; set; } = null!;
}
