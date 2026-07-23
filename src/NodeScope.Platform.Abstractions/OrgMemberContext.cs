namespace NodeScope.Platform.Abstractions;

/// <summary>
/// The requester's organization membership, resolved once per request from the
/// <c>OrganizationMember</c> table (the Node API's <c>request.orgMember</c>). Null on a
/// request means "authenticated but not in any org" - consumers decide whether that is
/// an error (<c>ORG_002</c>), exactly as the Nest guards did.
/// </summary>
/// <param name="MemberId">The <c>OrganizationMember.id</c> (not the user id).</param>
/// <param name="OrganizationId">The organization the member belongs to.</param>
/// <param name="Role">One of <see cref="OrgRoleNames"/>.</param>
public sealed record OrgMemberContext(string MemberId, string OrganizationId, string Role)
{
    /// <summary>True when the member holds one of <paramref name="roles"/>.</summary>
    public bool HasRole(params string[] roles) => roles.Contains(Role, StringComparer.Ordinal);
}

/// <summary>The <c>OrgRole</c> enum values as stored in Postgres, verbatim.</summary>
public static class OrgRoleNames
{
    public const string Owner = "OWNER";
    public const string Admin = "ADMIN";
    public const string Member = "MEMBER";
}
