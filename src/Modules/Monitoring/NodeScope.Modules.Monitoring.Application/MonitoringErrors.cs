using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Monitoring.Application;

/// <summary>Monitoring's module-owned error codes, verbatim from the Node services.</summary>
public static class MonitoringErrors
{
    /// <summary>401 <c>AGENT_001</c>: unknown, expired, or already-claimed enrollment code.</summary>
    public static ApiException InvalidEnrollmentCode() =>
        new("AGENT_001", "Invalid or expired enrollment code", 401);

    /// <summary>404 <c>AGENT_002</c>: agent unknown or belonging to another org (indistinguishable).</summary>
    public static ApiException AgentNotFound() => new("AGENT_002", "NOT_FOUND", 404);
}
