using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class DeviceStatus
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string DeviceId { get; set; } = null!;

    public DeviceStatusState State { get; set; }

    public double? LatencyMs { get; set; }

    public int ConsecutiveFails { get; set; }

    public DateTime? LastCheckAt { get; set; }

    public DateTime? LastOkAt { get; set; }

    public DateTime? LastChangeAt { get; set; }

    public string? Source { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual Device Device { get; set; } = null!;

    public virtual Organization Organization { get; set; } = null!;
}
