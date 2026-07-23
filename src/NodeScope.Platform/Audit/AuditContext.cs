namespace NodeScope.Platform.Audit;

/// <summary>
/// Per-request audit context, the C# shape of the Node <c>auditAls</c> store. The request
/// pipeline stamps <see cref="RequestId"/>, <see cref="IpAddress"/> and
/// <see cref="UserAgent"/> at the front door; the session authentication handler fills in
/// <see cref="UserId"/> once the requester is known.
/// </summary>
public sealed class AuditContext
{
    /// <summary>Fresh UUID per request ("unknown" outside a request, matching Node).</summary>
    public string RequestId { get; set; } = "unknown";

    public string? UserId { get; set; }

    public string? IpAddress { get; set; }

    public string? UserAgent { get; set; }
}
