namespace NodeScope.Platform.Abstractions;

/// <summary>
/// The change-log audit trail, ported from the Node <c>AuditService</c>. Domain services
/// call it explicitly on mutations (there is no interceptor doing it automatically, matching
/// the Node design); rows land in the <c>ChangeLog</c> table with the request's context
/// (request id, user, ip, user-agent) attached.
/// </summary>
public interface IAuditService
{
    /// <summary>A CREATE row carrying the full entity as <c>snapshot</c>.</summary>
    public Task RecordCreateAsync(
        string organizationId,
        string entityType,
        string entityId,
        object snapshot,
        CancellationToken cancellationToken);

    /// <summary>One UPDATE row per changed field, values stringified like Node's <c>String(v)</c>.</summary>
    public Task RecordUpdateAsync(
        string organizationId,
        string entityType,
        string entityId,
        IReadOnlyList<AuditFieldChange> changes,
        CancellationToken cancellationToken);

    /// <summary>A DELETE row carrying the removed entity as <c>snapshot</c>.</summary>
    public Task RecordDeleteAsync(
        string organizationId,
        string entityType,
        string entityId,
        object snapshot,
        CancellationToken cancellationToken);
}

/// <summary>A single field transition inside an UPDATE audit record.</summary>
public sealed record AuditFieldChange(string Field, string? OldValue, string? NewValue);
