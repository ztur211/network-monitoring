using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class JoinRequest
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string UserId { get; set; } = null!;

    public JoinRequestStatus Status { get; set; }

    public string? DecidedByUserId { get; set; }

    public DateTime? DecidedAt { get; set; }

    public DateTime CreatedAt { get; set; }

    public virtual Organization Organization { get; set; } = null!;

    public virtual User User { get; set; } = null!;
}
