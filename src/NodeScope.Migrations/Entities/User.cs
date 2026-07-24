using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class User
{
    public string Id { get; set; } = null!;

    public string Email { get; set; } = null!;

    public bool EmailVerified { get; set; }

    public string? Name { get; set; }

    public string? Image { get; set; }

    public double? HomeLatitude { get; set; }

    public double? HomeLongitude { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public AccountTier Tier { get; set; }

    public string MapPreferences { get; set; } = null!;

    public DateTime? OnboardingCompletedAt { get; set; }

    public bool IsSuperAdmin { get; set; }

    public virtual ICollection<Account> Account { get; set; } = new List<Account>();

    public virtual ICollection<ChangeLog> ChangeLog { get; set; } = new List<ChangeLog>();

    public virtual ICollection<Circuit> Circuit { get; set; } = new List<Circuit>();

    public virtual ICollection<Device> Device { get; set; } = new List<Device>();

    public virtual ICollection<DeviceConnection> DeviceConnection { get; set; } = new List<DeviceConnection>();

    public virtual ICollection<FiberRun> FiberRun { get; set; } = new List<FiberRun>();

    public virtual ICollection<JoinRequest> JoinRequest { get; set; } = new List<JoinRequest>();

    public virtual ICollection<Network> Network { get; set; } = new List<Network>();

    public virtual OrganizationMember? OrganizationMember { get; set; }

    public virtual ICollection<Session> Session { get; set; } = new List<Session>();
}
