namespace NodeScope.Desktop.Api;

/// <summary>
/// The slice of <c>GET /api/v1/users/me</c> the client renders. A client-local read model,
/// deliberately not shared with the server: the contract suite guards the wire, and the
/// client only ever narrows it.
/// </summary>
internal sealed record CurrentUser(
    string Id,
    string Email,
    string? Name,
    double? HomeLatitude = null,
    double? HomeLongitude = null);
