using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class Property
{
    public string Id { get; set; } = null!;

    public string OrganizationId { get; set; } = null!;

    public string? ParentId { get; set; }

    public string Name { get; set; } = null!;

    public PropertyType Type { get; set; }

    public string? Code { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual BuildingModel? BuildingModel { get; set; }

    public virtual ICollection<Device> Device { get; set; } = new List<Device>();

    public virtual ICollection<Property> InverseParent { get; set; } = new List<Property>();

    public virtual ICollection<MemberProperty> MemberProperty { get; set; } = new List<MemberProperty>();

    public virtual ICollection<NetworkProperty> NetworkProperty { get; set; } = new List<NetworkProperty>();

    public virtual Organization Organization { get; set; } = null!;

    public virtual Property? Parent { get; set; }

    public virtual ICollection<TeamProperty> TeamProperty { get; set; } = new List<TeamProperty>();
}
