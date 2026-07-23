namespace NodeScope.Modules.Identity.Domain;

/// <summary>The Postgres <c>AccountTier</c> enum (labels via the CONSTANT_CASE translator).</summary>
public enum AccountTier
{
    PersonalFree,
    PersonalPaid,
    MultiProperty,
    Enterprise,
}

/// <summary>The Postgres <c>OrgRole</c> enum.</summary>
public enum OrgRole
{
    Owner,
    Admin,
    Member,
}

/// <summary>The Postgres <c>JoinRequestStatus</c> enum.</summary>
public enum JoinRequestStatus
{
    Pending,
    Approved,
    Denied,
}

/// <summary>Wire-label conversion (the DB labels are the wire values).</summary>
public static class IdentityLabels
{
    public static string Of(AccountTier value) => value switch
    {
        AccountTier.PersonalFree => "PERSONAL_FREE",
        AccountTier.PersonalPaid => "PERSONAL_PAID",
        AccountTier.MultiProperty => "MULTI_PROPERTY",
        AccountTier.Enterprise => "ENTERPRISE",
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };

    public static string Of(OrgRole value) => value switch
    {
        OrgRole.Owner => "OWNER",
        OrgRole.Admin => "ADMIN",
        OrgRole.Member => "MEMBER",
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };

    public static string Of(JoinRequestStatus value) => value switch
    {
        JoinRequestStatus.Pending => "PENDING",
        JoinRequestStatus.Approved => "APPROVED",
        JoinRequestStatus.Denied => "DENIED",
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };

    public static JoinRequestStatus? TryParseJoinRequestStatus(string? label) => label switch
    {
        "PENDING" => JoinRequestStatus.Pending,
        "APPROVED" => JoinRequestStatus.Approved,
        "DENIED" => JoinRequestStatus.Denied,
        _ => null,
    };

    public static OrgRole? TryParseRole(string? label) => label switch
    {
        "OWNER" => OrgRole.Owner,
        "ADMIN" => OrgRole.Admin,
        "MEMBER" => OrgRole.Member,
        _ => null,
    };
}
