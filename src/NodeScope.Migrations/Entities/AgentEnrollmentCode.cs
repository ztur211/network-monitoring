using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class AgentEnrollmentCode
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string CodeHash { get; set; } = null!;

    public DateTime ExpiresAt { get; set; }

    public string? CreatedByMemberId { get; set; }

    public DateTime? UsedAt { get; set; }

    public DateTime CreatedAt { get; set; }

    public virtual Organization Organization { get; set; } = null!;
}
