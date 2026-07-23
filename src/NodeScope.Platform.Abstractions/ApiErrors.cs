namespace NodeScope.Platform.Abstractions;

/// <summary>
/// Factories for the error envelopes owned by cross-cutting infrastructure (the codes the
/// Node API's global exception filter and guards emit). Module-specific codes
/// (<c>AGENT_*</c>, <c>SNMP_*</c>, ...) belong to their module's Application layer, exactly
/// as they were scattered per-service in the Node code - this class is only the shared core.
/// </summary>
public static class ApiErrors
{
    /// <summary>400/413 <c>GEN_001 MALFORMED_REQUEST</c>: unparseable body, bad encoding, oversized payload.</summary>
    public static ApiException MalformedRequest(int statusCode = 400) =>
        new("GEN_001", "MALFORMED_REQUEST", statusCode);

    /// <summary>400 <c>GEN_001 VALIDATION_ERROR</c> with the constraint messages as details.</summary>
    public static ApiException Validation(IReadOnlyList<string> details) =>
        new("GEN_001", "VALIDATION_ERROR", 400, details);

    /// <summary>404 <c>GEN_002 NOT_FOUND</c>.</summary>
    public static ApiException NotFound() => new("GEN_002", "NOT_FOUND", 404);

    /// <summary>429 <c>GEN_004 RATE_LIMITED</c>.</summary>
    public static ApiException RateLimited() => new("GEN_004", "RATE_LIMITED", 429);

    /// <summary>401 <c>AUTH_002 SESSION_INVALID</c>: every missing/invalid credential, machine tokens included.</summary>
    public static ApiException SessionInvalid() => new("AUTH_002", "SESSION_INVALID", 401);

    /// <summary>403 <c>ORG_002 NOT_AN_ORG_MEMBER</c>: authenticated but org context required and absent.</summary>
    public static ApiException NotAnOrgMember() => new("ORG_002", "NOT_AN_ORG_MEMBER", 403);

    /// <summary>403 <c>ORG_003 INSUFFICIENT_ORG_ROLE</c>: org member without a required role (role guard).</summary>
    public static ApiException InsufficientOrgRole() => new("ORG_003", "INSUFFICIENT_ORG_ROLE", 403);

    /// <summary>
    /// 403 <c>ORG_003 FORBIDDEN_ROLE</c>: same code, different message - the wording the Node
    /// permissions service used when a MEMBER hit an F3-gated operation.
    /// </summary>
    public static ApiException ForbiddenRole() => new("ORG_003", "FORBIDDEN_ROLE", 403);

    /// <summary>403 <c>PERM_001 OUTSIDE_ASSIGNED_SCOPE</c>: ADMIN acting outside their assigned sites.</summary>
    public static ApiException OutsideAssignedScope() => new("PERM_001", "OUTSIDE_ASSIGNED_SCOPE", 403);

    /// <summary>403 <c>PERM_004 NETWORK_PARTIAL_SCOPE</c>: ADMIN covering only part of a network's sites.</summary>
    public static ApiException NetworkPartialScope() => new("PERM_004", "NETWORK_PARTIAL_SCOPE", 403);
}
