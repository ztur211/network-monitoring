namespace NodeScope.Desktop.Api;

/// <summary>The caller's organization as rendered by the native settings surface.</summary>
internal sealed record OrganizationSummary(
    string Id,
    string Name,
    int Version);

/// <summary>One person in the organization roster.</summary>
internal sealed record OrganizationMember(
    string Id,
    string UserId,
    string OrganizationId,
    string Role,
    DateTime CreatedAt,
    string? Email = null,
    string? Name = null)
{
    public string DisplayName =>
        Name is { Length: > 0 } name ? name : Email is { Length: > 0 } email ? email : UserId;

    public string DetailLine =>
        Email is { Length: > 0 } email && !string.Equals(email, DisplayName, StringComparison.Ordinal)
            ? $"{email}  ·  {Role}"
            : Role;
}

/// <summary>An unredeemed invitation. Its credential only appears in the create response.</summary>
internal sealed record PendingInvitation(
    string Id,
    string Email,
    string Role,
    DateTime ExpiresAt,
    DateTime? AcceptedAt,
    DateTime CreatedAt)
{
    public string DetailLine => $"{Role}  ·  expires {ExpiresAt:yyyy-MM-dd}";
}

/// <summary>The one response in which the appliance reveals an invitation credential.</summary>
internal sealed record CreatedInvitation(
    PendingInvitation Invitation,
    string Token);

/// <summary>A domain-routed request from an authenticated user who is not yet a member.</summary>
internal sealed record OrganizationJoinRequest(
    string Id,
    string OrganizationId,
    string UserId,
    string Status,
    DateTime CreatedAt,
    DateTime? DecidedAt,
    string? Email = null,
    string? Name = null)
{
    public string DisplayName =>
        Name is { Length: > 0 } name ? name : Email is { Length: > 0 } email ? email : UserId;

    public string DetailLine =>
        Email is { Length: > 0 } email && !string.Equals(email, DisplayName, StringComparison.Ordinal)
            ? email
            : "Awaiting a decision";
}
