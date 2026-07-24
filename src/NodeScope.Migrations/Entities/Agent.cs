using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class Agent
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string Name { get; set; } = null!;

    public string? Platform { get; set; }

    public string? Version { get; set; }

    public AgentStatus Status { get; set; }

    public DateTime? LastSeenAt { get; set; }

    public string TokenHash { get; set; } = null!;

    public string? CreatedByMemberId { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual Organization Organization { get; set; } = null!;
}
