namespace NodeScope.Platform.Abstractions;

/// <summary>
/// Resolves a user's organization membership outside the HTTP request pipeline.
/// <see cref="IOrgContextAccessor"/> is populated by authentication and lives for that request
/// only; a realtime connection outlives it and runs its hub callbacks in their own scopes, so
/// it looks membership up by user id instead.
/// </summary>
public interface IOrgMembershipResolver
{
    /// <summary>The user's membership, or null when they belong to no organization.</summary>
    public Task<OrgMemberContext?> ForUserAsync(string userId, CancellationToken cancellationToken);
}
