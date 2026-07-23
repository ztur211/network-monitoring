namespace NodeScope.Platform.Abstractions;

/// <summary>
/// F3 permission scoping, ported from the Node API's <c>PermissionsService</c>. A member's
/// scope is the union of the property subtrees under their effective roots (direct
/// <c>MemberProperty</c> grants plus team <c>TeamProperty</c> grants); an OWNER is unscoped.
/// Implemented by Identity's infrastructure; consumed by every module that filters or gates
/// by property visibility.
/// </summary>
public interface IPermissionScopeService
{
    /// <summary>
    /// The property ids visible to <paramref name="member"/>, or null when unscoped (OWNER).
    /// This is the <c>DeviceScope.propertyIdIn</c> array the Node services passed around.
    /// </summary>
    public Task<IReadOnlyList<string>?> ScopePropertyIdsAsync(OrgMemberContext member, CancellationToken cancellationToken);

    /// <summary>True when <paramref name="propertyId"/> is inside the member's scope (OWNER: always).</summary>
    public Task<bool> IsInScopeAsync(OrgMemberContext member, string propertyId, CancellationToken cancellationToken);

    /// <summary>
    /// The property and every descendant (org-scoped, cycle-guarded) - the shared downward
    /// walk every subtree consumer uses (building device sets, scope expansion). An unknown
    /// or foreign root yields an empty list.
    /// </summary>
    public Task<IReadOnlyList<string>> SubtreePropertyIdsAsync(
        string organizationId,
        string rootPropertyId,
        CancellationToken cancellationToken);

    /// <summary>
    /// The property and every ancestor up to the root (org-scoped, cycle-guarded). Realtime
    /// fan-out needs it: a subscriber assigned to a site must receive events about anything
    /// beneath it, so an event addresses the whole ancestor chain of its governing site.
    /// </summary>
    public Task<IReadOnlyList<string>> AncestorPropertyIdsAsync(
        string organizationId,
        string propertyId,
        CancellationToken cancellationToken);

    /// <summary>
    /// The member's assigned roots, un-expanded: null for an OWNER (unscoped), an empty list
    /// for a member with no grants. This is what a live subscriber's scope subscriptions
    /// mirror, so the fan-out can address rooms instead of filtering every socket per event.
    /// </summary>
    public Task<IReadOnlyList<string>?> EffectiveRootPropertyIdsAsync(
        OrgMemberContext member,
        CancellationToken cancellationToken);

    /// <summary>
    /// Gate for configuring a device under <paramref name="governingSitePropertyId"/>:
    /// OWNER passes, MEMBER throws <c>ORG_003</c>, ADMIN throws <c>PERM_001</c> when the site
    /// is outside their scope.
    /// </summary>
    public Task AssertCanConfigureAsync(OrgMemberContext member, string governingSitePropertyId, CancellationToken cancellationToken);

    /// <summary>
    /// Gate for configuring a whole network: OWNER passes, MEMBER throws <c>ORG_003</c>,
    /// ADMIN throws <c>PERM_004</c> unless every one of <paramref name="propertyIds"/> is in scope.
    /// </summary>
    public Task AssertNetworkFullCoverageAsync(
        OrgMemberContext member,
        IReadOnlyCollection<string> propertyIds,
        CancellationToken cancellationToken);
}
