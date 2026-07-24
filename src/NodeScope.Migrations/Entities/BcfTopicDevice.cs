using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class BcfTopicDevice
{
    public string Id { get; set; } = null!;

    public string TopicId { get; set; } = null!;

    public string DeviceId { get; set; } = null!;

    public virtual BcfTopic Topic { get; set; } = null!;
}
