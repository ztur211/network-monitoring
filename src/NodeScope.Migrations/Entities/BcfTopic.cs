using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class BcfTopic
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string PropertyId { get; set; } = null!;

    public string Guid { get; set; } = null!;

    public string Title { get; set; } = null!;

    public string? TopicType { get; set; }

    public string? TopicStatus { get; set; }

    public string? Priority { get; set; }

    public List<string>? Labels { get; set; }

    public string CreationAuthor { get; set; } = null!;

    public DateTime CreationDate { get; set; }

    public string? ModifiedAuthor { get; set; }

    public DateTime? ModifiedDate { get; set; }

    public string? AssignedTo { get; set; }

    public DateTime? DueDate { get; set; }

    public string? Description { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual ICollection<BcfComment> BcfComment { get; set; } = new List<BcfComment>();

    public virtual ICollection<BcfTopicDevice> BcfTopicDevice { get; set; } = new List<BcfTopicDevice>();

    public virtual ICollection<BcfViewpoint> BcfViewpoint { get; set; } = new List<BcfViewpoint>();

    public virtual Organization Organization { get; set; } = null!;
}
