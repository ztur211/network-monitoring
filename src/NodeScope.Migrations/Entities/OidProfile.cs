using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class OidProfile
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string Name { get; set; } = null!;

    public bool IncludeInterfaceMetrics { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual ICollection<Device> Device { get; set; } = new List<Device>();

    public virtual ICollection<Network> Network { get; set; } = new List<Network>();

    public virtual ICollection<OidEntry> OidEntry { get; set; } = new List<OidEntry>();

    public virtual Organization Organization { get; set; } = null!;
}
