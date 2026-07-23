using System.Text.Json.Serialization;
using NodeScope.Modules.Monitoring.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Monitoring.Application.Snmp;

/// <summary>Credential wire DTO: secrets in, only <c>has*</c> presence flags out. Never the <c>*Enc</c> names.</summary>
public sealed record SnmpCredentialDto(
    string Id,
    string OrganizationId,
    string Name,
    string SnmpVersion,
    string? SecurityLevel,
    string? SecurityName,
    string? AuthProtocol,
    string? PrivProtocol,
    bool HasCommunity,
    bool HasAuthKey,
    bool HasPrivKey,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt);

/// <summary>Profile wire DTO with entries.</summary>
public sealed record OidProfileDto(
    string Id,
    string OrganizationId,
    string Name,
    bool IncludeInterfaceMetrics,
    IReadOnlyList<OidEntryDto> Entries,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt);

/// <summary>Profile wire DTO without entries (list endpoint).</summary>
public sealed record OidProfileSummaryDto(
    string Id,
    string OrganizationId,
    string Name,
    bool IncludeInterfaceMetrics,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public sealed record OidEntryDto(string Id, string Oid, string Metric);

/// <summary>The assign response body (nulls included, matching Node).</summary>
public sealed record AssignResultDto(
    string TargetType,
    string TargetId,
    string? SnmpCredentialId,
    string? OidProfileId);

/// <summary>Body of <c>POST /api/v1/snmp/credentials</c>.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class CreateSnmpCredentialRequest
{
    public string? Name { get; init; }

    public string? SnmpVersion { get; init; }

    public string? SecurityLevel { get; init; }

    public string? SecurityName { get; init; }

    public string? AuthProtocol { get; init; }

    public string? PrivProtocol { get; init; }

    public string? Community { get; init; }

    public string? AuthKey { get; init; }

    public string? PrivKey { get; init; }

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        RequestValidation.RequireNonEmptyString(errors, Name, "name");
        RequireEnum(errors, SnmpVersion, required: true, "snmpVersion", ["V2C", "V3"]);
        RequireEnum(errors, SecurityLevel, required: false, "securityLevel", ["NO_AUTH_NO_PRIV", "AUTH_NO_PRIV", "AUTH_PRIV"]);
        RequireEnum(errors, AuthProtocol, required: false, "authProtocol", ["MD5", "SHA", "SHA256"]);
        RequireEnum(errors, PrivProtocol, required: false, "privProtocol", ["DES", "AES", "AES256"]);
        return errors;
    }

    internal static void RequireEnum(
        List<string> errors,
        string? value,
        bool required,
        string field,
        IReadOnlyList<string> allowed)
    {
        if (value is null)
        {
            if (required)
            {
                errors.Add($"{field} must be one of the following values: {string.Join(", ", allowed)}");
            }

            return;
        }

        if (!allowed.Contains(value, StringComparer.Ordinal))
        {
            errors.Add($"{field} must be one of the following values: {string.Join(", ", allowed)}");
        }
    }
}

/// <summary>Body of <c>POST /api/v1/snmp/oid-profiles</c>.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class CreateOidProfileRequest
{
    public string? Name { get; init; }

    public bool? IncludeInterfaceMetrics { get; init; }

    public IReadOnlyList<CreateOidEntryRequest>? Entries { get; init; }

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        RequestValidation.RequireNonEmptyString(errors, Name, "name");
        for (var i = 0; i < (Entries?.Count ?? 0); i++)
        {
            RequestValidation.RequireNonEmptyString(errors, Entries![i].Oid, $"entries.{i}.oid");
            RequestValidation.RequireNonEmptyString(errors, Entries[i].Metric, $"entries.{i}.metric");
        }

        return errors;
    }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class CreateOidEntryRequest
{
    public string? Oid { get; init; }

    public string? Metric { get; init; }
}

/// <summary>A credential row as the application layer sees it (secrets still encrypted).</summary>
public sealed record SnmpCredentialRecord(
    string Id,
    string OrganizationId,
    string Name,
    SnmpVersion SnmpVersion,
    SnmpSecurityLevel? SecurityLevel,
    string? SecurityName,
    SnmpAuthProtocol? AuthProtocol,
    SnmpPrivProtocol? PrivProtocol,
    string? CommunityEnc,
    string? AuthKeyEnc,
    string? PrivKeyEnc,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt);

/// <summary>A profile row (+ entries) as the application layer sees it.</summary>
public sealed record OidProfileRecord(
    string Id,
    string OrganizationId,
    string Name,
    bool IncludeInterfaceMetrics,
    IReadOnlyList<OidEntryRecord> Entries,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public sealed record OidEntryRecord(string Id, string Oid, string Metric);

/// <summary>A device's assignment chain: its own overrides plus its network's defaults.</summary>
public sealed record DeviceSnmpChain(
    string Id,
    string? SnmpCredentialId,
    string? OidProfileId,
    string? NetworkSnmpCredentialId,
    string? NetworkOidProfileId);

/// <summary>New credential fields, secrets already encrypted by the service.</summary>
public sealed record NewSnmpCredential(
    string OrganizationId,
    string Name,
    SnmpVersion SnmpVersion,
    SnmpSecurityLevel? SecurityLevel,
    string? SecurityName,
    SnmpAuthProtocol? AuthProtocol,
    SnmpPrivProtocol? PrivProtocol,
    string? CommunityEnc,
    string? AuthKeyEnc,
    string? PrivKeyEnc);
