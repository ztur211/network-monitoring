using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class Network
{
    public string Id { get; set; } = null!;

    public string? UserId { get; set; }

    public string Name { get; set; } = null!;

    public string? HomeAddress { get; set; }

    public double? HomeLatitude { get; set; }

    public double? HomeLongitude { get; set; }

    public string? HomePublicIp { get; set; }

    public string? Isp { get; set; }

    public double? DownMbps { get; set; }

    public double? UpMbps { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public string OrganizationId { get; set; } = null!;

    public string? OidProfileId { get; set; }

    public string? SnmpCredentialId { get; set; }

    public virtual ICollection<Device> Device { get; set; } = new List<Device>();

    public virtual ICollection<NetworkProperty> NetworkProperty { get; set; } = new List<NetworkProperty>();

    public virtual OidProfile? OidProfile { get; set; }

    public virtual Organization Organization { get; set; } = null!;

    public virtual SnmpCredential? SnmpCredential { get; set; }

    public virtual User? User { get; set; }
}
