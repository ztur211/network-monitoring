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

    public static OrgRole? TryParseRole(string? label) => label switch
    {
        "OWNER" => OrgRole.Owner,
        "ADMIN" => OrgRole.Admin,
        "MEMBER" => OrgRole.Member,
        _ => null,
    };
}
