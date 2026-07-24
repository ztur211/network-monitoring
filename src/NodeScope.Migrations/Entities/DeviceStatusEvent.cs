using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class DeviceStatusEvent
{
    public DateTime Time { get; set; }

    public string OrganizationId { get; set; } = null!;

    public string DeviceId { get; set; } = null!;

    public string State { get; set; } = null!;

    public string? Source { get; set; }
}
