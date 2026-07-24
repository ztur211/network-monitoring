using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class FiberRun
{
    public string Id { get; set; } = null!;

    public string? UserId { get; set; }

    public string Name { get; set; } = null!;

    public string StartDeviceId { get; set; } = null!;

    public string EndDeviceId { get; set; } = null!;

    public string? CableType { get; set; }

    public double? LengthMeters { get; set; }

    public string? Notes { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public string OrganizationId { get; set; } = null!;

    public virtual Device EndDevice { get; set; } = null!;

    public virtual Organization Organization { get; set; } = null!;

    public virtual Device StartDevice { get; set; } = null!;

    public virtual User? User { get; set; }
}
