namespace NodeScope.Desktop.Api;

/// <summary>The <c>POST /api/v1/users/location</c> result: resolved coordinates.</summary>
internal sealed record HomeLocation(double Latitude, double Longitude, string? Address);

/// <summary>One data source row from <c>GET /api/v1/users/me/data-sources</c>.</summary>
internal sealed record DataSource(string Type, bool Connected, DateTime? LastSeen, string Message);

/// <summary>One registered agent (<c>GET /api/v1/agents</c>).</summary>
internal sealed record Agent(
    string Id,
    string Name,
    string? Platform,
    string? Version,
    string Status,
    DateTime? LastSeenAt);

/// <summary>A credential as the API answers it: secrets in, only presence flags out.</summary>
internal sealed record SnmpCredential(
    string Id,
    string Name,
    string SnmpVersion,
    string? SecurityLevel,
    string? SecurityName,
    string? AuthProtocol,
    string? PrivProtocol,
    bool HasCommunity,
    bool HasAuthKey,
    bool HasPrivKey,
    int Version);

/// <summary>
/// Body of <c>POST /api/v1/snmp/credentials</c>. V2C carries a community; V3 the
/// security level/name and auth/priv protocol+key pairs (the full V3 surface the
/// retired web form never exposed).
/// </summary>
internal sealed record CreateSnmpCredential(
    string Name,
    string SnmpVersion,
    string? SecurityLevel,
    string? SecurityName,
    string? AuthProtocol,
    string? PrivProtocol,
    string? Community,
    string? AuthKey,
    string? PrivKey);

/// <summary>A profile row from <c>GET /api/v1/snmp/oid-profiles</c> (no entries).</summary>
internal sealed record OidProfileSummary(
    string Id,
    string Name,
    bool IncludeInterfaceMetrics,
    int Version);

internal sealed record CreateOidEntry(string Oid, string Metric);

/// <summary>Body of <c>POST /api/v1/snmp/oid-profiles</c>.</summary>
internal sealed record CreateOidProfile(
    string Name,
    bool IncludeInterfaceMetrics,
    IReadOnlyList<CreateOidEntry> Entries);

/// <summary>
/// Body AND result of <c>POST /api/v1/snmp/assign</c>. Both assignment ids must be
/// PRESENT on the wire - null means unassign, an absent member is a validation error -
/// which is why this record always serializes all four members.
/// </summary>
internal sealed record SnmpAssignment(
    string TargetType,
    string TargetId,
    string? SnmpCredentialId,
    string? OidProfileId);
