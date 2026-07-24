namespace NodeScope.Migrations.Entities;

// The 13 PostgreSQL enum types, mirrored for the migrations model only. Member names are
// PascalCase renderings of the CONSTANT_CASE labels (the constant-case name translator in
// MigrationsDbContextFactory maps them back); the labels themselves - the source of truth
// for CREATE TYPE - live in the HasPostgresEnum calls in MigrationsDbContext. Runtime
// modules keep their own enum definitions; nothing here is shared.

public enum AccountTier { PersonalFree, PersonalPaid, MultiProperty, Enterprise }

public enum AgentStatus { Pending, Approved, Revoked }

public enum ChangeAction { Create, Update, Delete }

public enum ConnectionType { Ethernet, Fiber, Wifi, Logical }

public enum DeviceCategory
{
    Rad, Ont, Dslam, Router, Modem, FiberMediaConverter, Firewall, Switch, AccessPoint,
    WifiExtender, WirelessBridge, ServerRack, PatchPanel, Ups, Computer, Phone, Tablet,
    Printer, IotDevice, Custom,
}

public enum DeviceMobility { HomeOnly, Roams, Unknown }

public enum DeviceStatusState { Up, Down, Warning, Unknown }

public enum JoinRequestStatus { Pending, Approved, Denied }

public enum OrgRole { Owner, Admin, Member }

public enum PropertyType { Site, Building, Floor, Area }

public enum SnmpAuthProtocol { Md5, Sha, Sha256 }

public enum SnmpPrivProtocol { Des, Aes, Aes256 }

public enum SnmpSecurityLevel { NoAuthNoPriv, AuthNoPriv, AuthPriv }

public enum SnmpVersion { V2c, V3 }
