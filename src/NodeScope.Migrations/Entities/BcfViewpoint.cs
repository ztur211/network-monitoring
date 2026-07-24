using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class BcfViewpoint
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string TopicId { get; set; } = null!;

    public string Guid { get; set; } = null!;

    public string Camera { get; set; } = null!;

    public string Components { get; set; } = null!;

    public string ClippingPlanes { get; set; } = null!;

    public string? SnapshotKey { get; set; }

    public bool IsPrimary { get; set; }

    public virtual BcfTopic Topic { get; set; } = null!;
}
