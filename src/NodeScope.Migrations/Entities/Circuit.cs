using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class Circuit
{
    public string Id { get; set; } = null!;

    public string? UserId { get; set; }

    public string IspName { get; set; } = null!;

    public string? CircuitId { get; set; }

    public string ServiceType { get; set; } = null!;

    public double? Bandwidth { get; set; }

    public string? DeviceId { get; set; }

    public string? Notes { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public string OrganizationId { get; set; } = null!;

    public virtual Device? Device { get; set; }

    public virtual Organization Organization { get; set; } = null!;

    public virtual User? User { get; set; }
}
