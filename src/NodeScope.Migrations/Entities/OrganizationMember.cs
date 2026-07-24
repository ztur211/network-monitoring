using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class OrganizationMember
{
    public string Id { get; set; } = null!;

    public string UserId { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public OrgRole Role { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual ICollection<MemberProperty> MemberProperty { get; set; } = new List<MemberProperty>();

    public virtual Organization Organization { get; set; } = null!;

    public virtual ICollection<Team> Team { get; set; } = new List<Team>();

    public virtual ICollection<TeamMember> TeamMember { get; set; } = new List<TeamMember>();

    public virtual User User { get; set; } = null!;
}
