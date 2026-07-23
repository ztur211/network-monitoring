using NodeScope.Platform.Abstractions;

namespace NodeScope.Platform.Http;

/// <summary>
/// The scoped, writable backing store for <see cref="IOrgContextAccessor"/>. The session
/// authentication handler resolves the requester's membership once per request and sets it
/// here (the Node API's <c>OrgContextGuard</c> writing <c>request.orgMember</c>); everything
/// downstream reads it through the accessor interface.
/// </summary>
public sealed class OrgContextHolder : IOrgContextAccessor
{
    /// <inheritdoc />
    public OrgMemberContext? OrgMember { get; set; }
}
