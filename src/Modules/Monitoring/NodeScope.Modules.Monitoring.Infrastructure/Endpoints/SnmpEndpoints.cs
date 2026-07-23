using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NodeScope.Modules.Monitoring.Application.Snmp;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Monitoring.Infrastructure.Endpoints;

/// <summary>
/// <c>/api/v1/snmp</c> (Node's <c>snmp.controller.ts</c>). The WHOLE surface - reads
/// included - is OWNER/ADMIN role-gated. Assign takes its body as raw JSON because the
/// contract distinguishes an ABSENT assignment field (validation error) from an explicit
/// null (unassign), which typed binding cannot express.
/// </summary>
internal static class SnmpEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/snmp")
            .RequireOrgRoles(OrgRoleNames.Owner, OrgRoleNames.Admin);

        group.MapPost("/credentials", CreateCredentialAsync);
        group.MapGet("/credentials", ListCredentialsAsync);
        group.MapGet("/credentials/{id}", GetCredentialAsync);
        group.MapDelete("/credentials/{id}", DeleteCredentialAsync);
        group.MapPost("/oid-profiles", CreateProfileAsync);
        group.MapGet("/oid-profiles", ListProfilesAsync);
        group.MapGet("/oid-profiles/{id}", GetProfileAsync);
        group.MapDelete("/oid-profiles/{id}", DeleteProfileAsync);
        group.MapPost("/assign", AssignAsync);
    }

    private static async Task<IResult> CreateCredentialAsync(
        CreateSnmpCredentialRequest body,
        IOrgContextAccessor org,
        SnmpService service,
        CancellationToken cancellationToken)
    {
        var errors = body.Validate();
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }

        return ApiEnvelope.Created(
            await service.CreateCredentialAsync(org.OrgMember!.OrganizationId, body, cancellationToken));
    }

    private static async Task<IResult> ListCredentialsAsync(
        IOrgContextAccessor org,
        SnmpService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.ListCredentialsAsync(org.OrgMember!.OrganizationId, cancellationToken));

    private static async Task<IResult> GetCredentialAsync(
        string id,
        IOrgContextAccessor org,
        SnmpService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.GetCredentialAsync(org.OrgMember!.OrganizationId, id, cancellationToken));

    private static async Task<IResult> DeleteCredentialAsync(
        string id,
        IOrgContextAccessor org,
        SnmpService service,
        CancellationToken cancellationToken)
    {
        await service.DeleteCredentialAsync(org.OrgMember!.OrganizationId, id, cancellationToken);
        return ApiEnvelope.Ok(new { id });
    }

    private static async Task<IResult> CreateProfileAsync(
        CreateOidProfileRequest body,
        IOrgContextAccessor org,
        SnmpService service,
        CancellationToken cancellationToken)
    {
        var errors = body.Validate();
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }

        return ApiEnvelope.Created(
            await service.CreateProfileAsync(org.OrgMember!.OrganizationId, body, cancellationToken));
    }

    private static async Task<IResult> ListProfilesAsync(
        IOrgContextAccessor org,
        SnmpService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.ListProfilesAsync(org.OrgMember!.OrganizationId, cancellationToken));

    private static async Task<IResult> GetProfileAsync(
        string id,
        IOrgContextAccessor org,
        SnmpService service,
        CancellationToken cancellationToken) =>
        ApiEnvelope.Ok(await service.GetProfileAsync(org.OrgMember!.OrganizationId, id, cancellationToken));

    private static async Task<IResult> DeleteProfileAsync(
        string id,
        IOrgContextAccessor org,
        SnmpService service,
        CancellationToken cancellationToken)
    {
        await service.DeleteProfileAsync(org.OrgMember!.OrganizationId, id, cancellationToken);
        return ApiEnvelope.Ok(new { id });
    }

    private static async Task<IResult> AssignAsync(
        JsonElement body,
        IOrgContextAccessor org,
        SnmpService service,
        CancellationToken cancellationToken)
    {
        var (targetType, targetId, credentialId, profileId) = ValidateAssignBody(body);
        return ApiEnvelope.Ok(await service.AssignAsync(
            org.OrgMember!, targetType, targetId, credentialId, profileId, cancellationToken));
    }

    /// <summary>
    /// Node's <c>AssignSnmpDto</c>: targetType/targetId required; both assignment fields
    /// required-PRESENT with null meaning unassign; unknown members rejected
    /// (forbidNonWhitelisted).
    /// </summary>
    private static (string TargetType, string TargetId, string? CredentialId, string? ProfileId)
        ValidateAssignBody(JsonElement body)
    {
        var errors = new List<string>();
        string? targetType = null;
        string? targetId = null;
        string? credentialId = null;
        string? profileId = null;
        var hasCredential = false;
        var hasProfile = false;

        if (body.ValueKind != JsonValueKind.Object)
        {
            throw ApiErrors.MalformedRequest();
        }

        foreach (var property in body.EnumerateObject())
        {
            switch (property.Name)
            {
                case "targetType":
                    targetType = property.Value.ValueKind == JsonValueKind.String ? property.Value.GetString() : null;
                    break;
                case "targetId":
                    targetId = property.Value.ValueKind == JsonValueKind.String ? property.Value.GetString() : null;
                    break;
                case "snmpCredentialId":
                    hasCredential = true;
                    if (property.Value.ValueKind == JsonValueKind.String)
                    {
                        credentialId = property.Value.GetString();
                    }
                    else if (property.Value.ValueKind != JsonValueKind.Null)
                    {
                        errors.Add("snmpCredentialId must be a string");
                    }

                    break;
                case "oidProfileId":
                    hasProfile = true;
                    if (property.Value.ValueKind == JsonValueKind.String)
                    {
                        profileId = property.Value.GetString();
                    }
                    else if (property.Value.ValueKind != JsonValueKind.Null)
                    {
                        errors.Add("oidProfileId must be a string");
                    }

                    break;
                default:
                    errors.Add($"property {property.Name} should not exist");
                    break;
            }
        }

        if (targetType is not ("network" or "device"))
        {
            errors.Add("targetType must be network or device");
        }

        RequestValidation.RequireNonEmptyString(errors, targetId, "targetId");
        if (!hasCredential)
        {
            errors.Add("snmpCredentialId should not be null or undefined");
        }

        if (!hasProfile)
        {
            errors.Add("oidProfileId should not be null or undefined");
        }

        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }

        return (targetType!, targetId!, credentialId, profileId);
    }
}
