using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NodeScope.Modules.Monitoring.Application.Reads;
using NodeScope.Modules.Monitoring.Domain;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Monitoring.Infrastructure.Endpoints;

/// <summary>
/// The F3-scoped monitoring reads (Node's <c>monitoring.controller.ts</c>): building
/// device-status, device metric series/names, and status events. Session-authenticated, any
/// org role - visibility is enforced per device (invisible-not-forbidden 404).
/// </summary>
internal static class MonitoringReadEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1").RequireOrgMember();
        group.MapGet("/buildings/{propertyId}/device-status", BuildingStatusAsync);
        group.MapGet("/devices/{id}/metrics", MetricsAsync);
        group.MapGet("/devices/{id}/metric-names", MetricNamesAsync);
        group.MapGet("/devices/{id}/status-events", StatusEventsAsync);
    }

    private static async Task<IResult> BuildingStatusAsync(
        string propertyId,
        IOrgContextAccessor org,
        MonitoringReadService service,
        CancellationToken cancellationToken)
    {
        RequireUuid(propertyId);
        return ApiEnvelope.Ok(await service.GetBuildingDeviceStatusAsync(org.OrgMember!, propertyId, cancellationToken));
    }

    private static async Task<IResult> MetricsAsync(
        string id,
        string? metric,
        string? from,
        string? to,
        string? bucket,
        IOrgContextAccessor org,
        MonitoringReadService service,
        CancellationToken cancellationToken)
    {
        RequireUuid(id);
        var errors = new List<string>();
        RequestValidation.RequireNonEmptyString(errors, metric, "metric");
        RequestValidation.MaxLength(errors, metric, "metric", 64);
        ValidateIso(errors, from, "from");
        ValidateIso(errors, to, "to");
        if (bucket is not null && !MetricBuckets.Allowed.Contains(bucket, StringComparer.Ordinal))
        {
            errors.Add($"bucket must be one of the following values: {string.Join(", ", MetricBuckets.Allowed)}");
        }

        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }

        return ApiEnvelope.Ok(await service.GetDeviceMetricsAsync(
            org.OrgMember!, id, metric!, from, to, bucket, cancellationToken));
    }

    private static async Task<IResult> MetricNamesAsync(
        string id,
        IOrgContextAccessor org,
        MonitoringReadService service,
        CancellationToken cancellationToken)
    {
        RequireUuid(id);
        return ApiEnvelope.Ok(await service.GetDeviceMetricNamesAsync(org.OrgMember!, id, cancellationToken));
    }

    private static async Task<IResult> StatusEventsAsync(
        string id,
        string? limit,
        IOrgContextAccessor org,
        MonitoringReadService service,
        CancellationToken cancellationToken)
    {
        RequireUuid(id);
        return ApiEnvelope.Ok(await service.GetDeviceStatusEventsAsync(org.OrgMember!, id, limit, cancellationToken));
    }

    /// <summary>Nest's <c>ParseUUIDPipe</c>: a non-uuid path id is a 400 before anything else.</summary>
    private static void RequireUuid(string value)
    {
        if (!Guid.TryParse(value, out _))
        {
            throw ApiErrors.Validation(["Validation failed (uuid is expected)"]);
        }
    }

    private static void ValidateIso(List<string> errors, string? value, string field)
    {
        if (value is not null
            && !DateTimeOffset.TryParse(
                value,
                System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.RoundtripKind,
                out _))
        {
            errors.Add($"{field} must be a valid ISO 8601 date string");
        }
    }
}
