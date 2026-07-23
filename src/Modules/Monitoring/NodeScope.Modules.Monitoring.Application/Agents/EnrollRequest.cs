using System.Text.Json.Serialization;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Monitoring.Application.Agents;

/// <summary>
/// Body of <c>POST /api/v1/monitoring/agent/enroll</c> (Node's <c>EnrollDto</c>): four
/// required non-empty strings. Unknown members are rejected, mirroring the Nest
/// ValidationPipe's <c>forbidNonWhitelisted</c>.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class EnrollRequest
{
    public string? Code { get; init; }

    public string? Name { get; init; }

    public string? Platform { get; init; }

    public string? Version { get; init; }

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        RequestValidation.RequireNonEmptyString(errors, Code, "code");
        RequestValidation.RequireNonEmptyString(errors, Name, "name");
        RequestValidation.RequireNonEmptyString(errors, Platform, "platform");
        RequestValidation.RequireNonEmptyString(errors, Version, "version");
        return errors;
    }
}
