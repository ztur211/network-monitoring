using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class Team
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string Name { get; set; } = null!;

    public string? CreatorMemberId { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual OrganizationMember? CreatorMember { get; set; }

    public virtual Organization Organization { get; set; } = null!;

    public virtual ICollection<TeamMember> TeamMember { get; set; } = new List<TeamMember>();

    public virtual ICollection<TeamProperty> TeamProperty { get; set; } = new List<TeamProperty>();
}
