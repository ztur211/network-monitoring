using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class Invitation
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string Email { get; set; } = null!;

    public string Token { get; set; } = null!;

    public OrgRole Role { get; set; }

    public DateTime ExpiresAt { get; set; }

    public string? InvitedByUserId { get; set; }

    public DateTime? AcceptedAt { get; set; }

    public DateTime CreatedAt { get; set; }

    public virtual Organization Organization { get; set; } = null!;
}
