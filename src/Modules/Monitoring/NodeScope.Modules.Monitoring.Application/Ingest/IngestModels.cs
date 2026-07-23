using System.Globalization;
using System.Text.Json.Serialization;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Monitoring.Application.Ingest;

/// <summary>
/// Body of <c>POST /api/v1/monitoring/ingest</c>, ported from <c>ingest.dto.ts</c>. The item
/// caps (1000 each) are enforced BEFORE field validation and map to 413 <c>GEN_005</c> - the
/// status code is a control signal: 413 tells the agent "split and retry", 400 tells it
/// "poison batch, drop". Getting that split wrong destroyed monitoring data once already;
/// see the Node DTO's comment block.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class IngestBatchRequest
{
    public const int MaxChecksPerBatch = 1000;
    public const int MaxMetricsPerBatch = 1000;

    public IReadOnlyList<StatusCheckItem>? Checks { get; init; }

    public IReadOnlyList<MetricSampleItem>? Metrics { get; init; }

    /// <summary>True when either array exceeds its cap (the 413 path, checked first).</summary>
    public bool ExceedsCaps() =>
        (Checks?.Count ?? 0) > MaxChecksPerBatch || (Metrics?.Count ?? 0) > MaxMetricsPerBatch;

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        for (var i = 0; i < (Checks?.Count ?? 0); i++)
        {
            Checks![i].Validate(errors, $"checks.{i}");
        }

        for (var i = 0; i < (Metrics?.Count ?? 0); i++)
        {
            Metrics![i].Validate(errors, $"metrics.{i}");
        }

        return errors;
    }
}

/// <summary>One reachability check result.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class StatusCheckItem
{
    private const double MaxLatencyMs = 600_000;

    public string? DeviceId { get; init; }

    public bool? Ok { get; init; }

    public double? LatencyMs { get; init; }

    public string? Source { get; init; }

    internal void Validate(ICollection<string> errors, string path)
    {
        RequestValidation.RequireNonEmptyString(errors, DeviceId, $"{path}.deviceId");
        RequestValidation.MaxLength(errors, DeviceId, $"{path}.deviceId", 64);
        if (Ok is null)
        {
            errors.Add($"{path}.ok must be a boolean value");
        }

        if (LatencyMs is < 0)
        {
            errors.Add($"{path}.latencyMs must not be less than 0");
        }

        if (LatencyMs is > MaxLatencyMs)
        {
            errors.Add($"{path}.latencyMs must not be greater than {MaxLatencyMs}");
        }

        RequestValidation.MaxLength(errors, Source, $"{path}.source", 64);
    }
}

/// <summary>One metric sample. Magnitude deliberately unbounded (64-bit SNMP counters).</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class MetricSampleItem
{
    public string? DeviceId { get; init; }

    public string? Metric { get; init; }

    public double? Value { get; init; }

    /// <summary>ISO-8601 timestamp; kept a string on the wire, parsed by the service.</summary>
    public string? Ts { get; init; }

    public string? Source { get; init; }

    internal void Validate(ICollection<string> errors, string path)
    {
        RequestValidation.RequireNonEmptyString(errors, DeviceId, $"{path}.deviceId");
        RequestValidation.MaxLength(errors, DeviceId, $"{path}.deviceId", 64);
        RequestValidation.RequireNonEmptyString(errors, Metric, $"{path}.metric");
        RequestValidation.MaxLength(errors, Metric, $"{path}.metric", 64);
        if (Value is null || double.IsNaN(Value.Value) || double.IsInfinity(Value.Value))
        {
            errors.Add($"{path}.value must be a number conforming to the specified constraints");
        }

        if (Ts is not null && !DateTimeOffset.TryParse(Ts, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out _))
        {
            errors.Add($"{path}.ts must be a valid ISO 8601 date string");
        }

        RequestValidation.MaxLength(errors, Source, $"{path}.source", 64);
    }
}
