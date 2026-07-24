using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class Organization
{
    public string Id { get; set; } = null!;

    public string Name { get; set; } = null!;

    public string? NamingPattern { get; set; }

    public int? NamingMaxLen { get; set; }

    public int Version { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public string? NamingTemplate { get; set; }

    public virtual ICollection<Agent> Agent { get; set; } = new List<Agent>();

    public virtual ICollection<AgentEnrollmentCode> AgentEnrollmentCode { get; set; } = new List<AgentEnrollmentCode>();

    public virtual ICollection<BcfTopic> BcfTopic { get; set; } = new List<BcfTopic>();

    public virtual ICollection<BuildingModel> BuildingModel { get; set; } = new List<BuildingModel>();

    public virtual ICollection<BuildingModelVersion> BuildingModelVersion { get; set; } = new List<BuildingModelVersion>();

    public virtual ICollection<ChangeLog> ChangeLog { get; set; } = new List<ChangeLog>();

    public virtual ICollection<Circuit> Circuit { get; set; } = new List<Circuit>();

    public virtual ICollection<Device> Device { get; set; } = new List<Device>();

    public virtual ICollection<DeviceConnection> DeviceConnection { get; set; } = new List<DeviceConnection>();

    public virtual ICollection<DeviceStatus> DeviceStatus { get; set; } = new List<DeviceStatus>();

    public virtual ICollection<FiberRun> FiberRun { get; set; } = new List<FiberRun>();

    public virtual ICollection<Invitation> Invitation { get; set; } = new List<Invitation>();

    public virtual ICollection<JoinRequest> JoinRequest { get; set; } = new List<JoinRequest>();

    public virtual ICollection<MemberProperty> MemberProperty { get; set; } = new List<MemberProperty>();

    public virtual MonitoringIngestToken? MonitoringIngestToken { get; set; }

    public virtual ICollection<Network> Network { get; set; } = new List<Network>();

    public virtual ICollection<NetworkProperty> NetworkProperty { get; set; } = new List<NetworkProperty>();

    public virtual ICollection<OidProfile> OidProfile { get; set; } = new List<OidProfile>();

    public virtual ICollection<OrganizationDomain> OrganizationDomain { get; set; } = new List<OrganizationDomain>();

    public virtual ICollection<OrganizationMember> OrganizationMember { get; set; } = new List<OrganizationMember>();

    public virtual ICollection<Property> Property { get; set; } = new List<Property>();

    public virtual ICollection<SnmpCredential> SnmpCredential { get; set; } = new List<SnmpCredential>();

    public virtual ICollection<Team> Team { get; set; } = new List<Team>();

    public virtual ICollection<TeamMember> TeamMember { get; set; } = new List<TeamMember>();

    public virtual ICollection<TeamProperty> TeamProperty { get; set; } = new List<TeamProperty>();
}
