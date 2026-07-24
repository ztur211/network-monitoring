using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class SnmpCredential
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string Name { get; set; } = null!;

    public SnmpVersion SnmpVersion { get; set; }

    public SnmpSecurityLevel? SecurityLevel { get; set; }

    public SnmpAuthProtocol? AuthProtocol { get; set; }

    public SnmpPrivProtocol? PrivProtocol { get; set; }

    public string? SecurityName { get; set; }

    public string? CommunityEnc { get; set; }

    public string? AuthKeyEnc { get; set; }

    public string? PrivKeyEnc { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual ICollection<Device> Device { get; set; } = new List<Device>();

    public virtual ICollection<Network> Network { get; set; } = new List<Network>();

    public virtual Organization Organization { get; set; } = null!;
}
