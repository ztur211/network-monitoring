using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class MonitoringMetric
{
    public DateTime Time { get; set; }

    public string OrganizationId { get; set; } = null!;

    public string DeviceId { get; set; } = null!;

    public string Metric { get; set; } = null!;

    public double Value { get; set; }

    public string? Source { get; set; }
}
