using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class MonitoringIngestToken
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string TokenHash { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual Organization Organization { get; set; } = null!;
}
