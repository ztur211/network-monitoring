namespace NodeScope.Platform.Abstractions;

/// <summary>
/// Per-request access to the resolved org membership. Identity's infrastructure populates
/// it after authentication; every module reads it through this interface so none of them
/// references Identity (Decision 2: cross-module needs go through Platform.Abstractions).
/// </summary>
public interface IOrgContextAccessor
{
    /// <summary>The requester's membership, or null when anonymous or org-less.</summary>
    public OrgMemberContext? OrgMember { get; }
}
