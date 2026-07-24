using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class DeviceConnection
{
    public string Id { get; set; } = null!;

    public string? UserId { get; set; }

    public string SourceDeviceId { get; set; } = null!;

    public string TargetDeviceId { get; set; } = null!;

    public ConnectionType ConnectionType { get; set; }

    public string? Notes { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public string OrganizationId { get; set; } = null!;

    public virtual Organization Organization { get; set; } = null!;

    public virtual Device SourceDevice { get; set; } = null!;

    public virtual Device TargetDevice { get; set; } = null!;

    public virtual User? User { get; set; }
}
