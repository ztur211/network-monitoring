using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class ChangeLog
{
    public string Id { get; set; } = null!;

    public string? UserId { get; set; }

    public ChangeAction Action { get; set; }

    public string EntityType { get; set; } = null!;

    public string EntityId { get; set; } = null!;

    public string? Field { get; set; }

    public string? OldValue { get; set; }

    public string? NewValue { get; set; }

    public DateTime CreatedAt { get; set; }

    public string? Comment { get; set; }

    public string? IpAddress { get; set; }

    public string OrganizationId { get; set; } = null!;

    public string RequestId { get; set; } = null!;

    public string? Snapshot { get; set; }

    public string? UserAgent { get; set; }

    public virtual Organization Organization { get; set; } = null!;

    public virtual User? User { get; set; }
}
