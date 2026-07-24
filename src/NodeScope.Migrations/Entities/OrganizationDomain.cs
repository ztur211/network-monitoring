using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class OrganizationDomain
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string Domain { get; set; } = null!;

    public bool Verified { get; set; }

    public DateTime CreatedAt { get; set; }

    public virtual Organization Organization { get; set; } = null!;
}
