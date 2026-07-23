using NodeScope.Platform.Abstractions;

namespace NodeScope.Platform.Http;

/// <summary>Route-parameter guards shared by every module's endpoints.</summary>
public static class RouteParams
{
    /// <summary>Nest's <c>ParseUUIDPipe</c>: a non-uuid path id is a 400 before anything else.</summary>
    public static void RequireUuid(string value)
    {
        if (!Guid.TryParse(value, out _))
        {
            throw ApiErrors.Validation(["Validation failed (uuid is expected)"]);
        }
    }
}
