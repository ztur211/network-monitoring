namespace NodeScope.Contracts.Monitoring;

/// <summary>One OID poll entry in an SNMP target descriptor (decrypted, agent-ready).</summary>
public sealed record SnmpOidEntry
{
    public required string Oid { get; init; }

    public required string Metric { get; init; }
}

/// <summary>
/// Effective SNMP credentials + profile for a device, ready for the agent.
/// Secrets (community, auth key, priv key) are decrypted and present here ONLY.
/// This DTO is never persisted or logged.
/// </summary>
public sealed record SnmpTargetDto
{
    /// <summary>"V2C" or "V3".</summary>
    public required string Version { get; init; }

    public string? Community { get; init; }

    public string? SecurityName { get; init; }

    public string? SecurityLevel { get; init; }

    public string? AuthProtocol { get; init; }

    public string? AuthKey { get; init; }

    public string? PrivProtocol { get; init; }

    public string? PrivKey { get; init; }

    public required IReadOnlyList<SnmpOidEntry> Oids { get; init; }

    public required bool InterfaceMetrics { get; init; }
}

public sealed record AgentDeviceDto
{
    public required string Id { get; init; }

    public required string Name { get; init; }

    public required string IpAddress { get; init; }

    /// <summary>SNMP target descriptor - present only when an effective credential is resolved.</summary>
    public SnmpTargetDto? Snmp { get; init; }
}

public sealed record AgentEnrollRequest
{
    public required string Code { get; init; }

    public required string Name { get; init; }

    public required string Platform { get; init; }

    public required string Version { get; init; }
}

public sealed record AgentEnrollResponse
{
    public required string AgentId { get; init; }

    public required string Token { get; init; }
}

public sealed record StatusCheckDto
{
    public required string DeviceId { get; init; }

    public required bool Ok { get; init; }

    public double? LatencyMs { get; init; }

    public string? Source { get; init; }
}

public sealed record MetricSampleDto
{
    public required string DeviceId { get; init; }

    public required string Metric { get; init; }

    public required double Value { get; init; }

    public string? Ts { get; init; }

    public string? Source { get; init; }
}

public sealed record IngestBatchDto
{
    public IReadOnlyList<StatusCheckDto>? Checks { get; init; }

    public IReadOnlyList<MetricSampleDto>? Metrics { get; init; }
}
