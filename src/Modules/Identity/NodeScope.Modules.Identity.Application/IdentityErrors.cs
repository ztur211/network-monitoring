using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Identity.Application;

/// <summary>Identity's module-owned error codes, verbatim from the Node services.</summary>
public static class IdentityErrors
{
    /// <summary>409 <c>AUTH_005</c>: another account already uses the address.</summary>
    public static ApiException EmailTaken() => new("AUTH_005", "EMAIL_TAKEN", 409);

    /// <summary>422 <c>MAP_001</c>: the address could not be resolved to coordinates.</summary>
    public static ApiException GeocodingFailed() => new("MAP_001", "GEOCODING_FAILED", 422);

    /// <summary>404 <c>ORG_001</c>: organization or member unknown.</summary>
    public static ApiException OrganizationNotFound() => new("ORG_001", "ORGANIZATION_NOT_FOUND", 404);

    /// <summary>409 <c>SYNC_001</c>: stale <c>baseVersion</c> on an organization patch.</summary>
    public static ApiException EditConflict() => Changesets.EditConflict();
}
