using System;
using System.Collections.Generic;
using NetTopologySuite.Geometries;

namespace NodeScope.Migrations.Entities;

public partial class Device
{
    public string Id { get; set; } = null!;

    public string? UserId { get; set; }

    public string Name { get; set; } = null!;

    public DeviceCategory Category { get; set; }

    public DeviceMobility Mobility { get; set; }

    public double? Latitude { get; set; }

    public double? Longitude { get; set; }

    public int? Floor { get; set; }

    public string? FloorLabel { get; set; }

    public string? IpAddress { get; set; }

    public string? MacAddress { get; set; }

    public string? Notes { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public Point? Location { get; set; }

    public string NetworkId { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string PropertyId { get; set; } = null!;

    public string? RoleCode { get; set; }

    public double? X { get; set; }

    public double? Y { get; set; }

    public double? Z { get; set; }

    public string? OidProfileId { get; set; }

    public string? SnmpCredentialId { get; set; }

    public string? IfcGlobalId { get; set; }

    public virtual ICollection<Circuit> Circuit { get; set; } = new List<Circuit>();

    public virtual ICollection<DeviceConnection> DeviceConnectionSourceDevice { get; set; } = new List<DeviceConnection>();

    public virtual ICollection<DeviceConnection> DeviceConnectionTargetDevice { get; set; } = new List<DeviceConnection>();

    public virtual DeviceStatus? DeviceStatus { get; set; }

    public virtual ICollection<FiberRun> FiberRunEndDevice { get; set; } = new List<FiberRun>();

    public virtual ICollection<FiberRun> FiberRunStartDevice { get; set; } = new List<FiberRun>();

    public virtual Network Network { get; set; } = null!;

    public virtual OidProfile? OidProfile { get; set; }

    public virtual Organization Organization { get; set; } = null!;

    public virtual Property Property { get; set; } = null!;

    public virtual SnmpCredential? SnmpCredential { get; set; }

    public virtual User? User { get; set; }
}
