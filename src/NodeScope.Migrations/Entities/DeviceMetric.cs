using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class DeviceMetric
{
    public string Id { get; set; } = null!;

    public string UserId { get; set; } = null!;

    public string SourceType { get; set; } = null!;

    public double? BandwidthDown { get; set; }

    public double? BandwidthUp { get; set; }

    public double? Latency { get; set; }

    public string? ConnectionQuality { get; set; }

    public DateTime Time { get; set; }

    public string? DeviceId { get; set; }

    public string? Tag { get; set; }

    public string OrganizationId { get; set; } = null!;
}
