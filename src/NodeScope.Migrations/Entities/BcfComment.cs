using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class BcfComment
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string TopicId { get; set; } = null!;

    public string Guid { get; set; } = null!;

    public string Comment { get; set; } = null!;

    public string Author { get; set; } = null!;

    public DateTime Date { get; set; }

    public string? ViewpointGuid { get; set; }

    public virtual BcfTopic Topic { get; set; } = null!;
}
