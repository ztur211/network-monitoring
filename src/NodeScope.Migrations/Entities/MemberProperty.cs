using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class MemberProperty
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string MemberId { get; set; } = null!;

    public string PropertyId { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public virtual OrganizationMember Member { get; set; } = null!;

    public virtual Organization Organization { get; set; } = null!;

    public virtual Property Property { get; set; } = null!;
}
