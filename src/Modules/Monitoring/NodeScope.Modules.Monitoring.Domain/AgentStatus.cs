namespace NodeScope.Modules.Monitoring.Domain;

/// <summary>The <c>AgentStatus</c> Postgres enum. Labels are the CONSTANT_CASE member names.</summary>
public enum AgentStatus
{
    Pending,
    Approved,
    Revoked,
}

/// <summary>Wire/label conversion for <see cref="AgentStatus"/> (the DB and DTOs carry the labels).</summary>
public static class AgentStatusLabel
{
    public static string Of(AgentStatus status) => status switch
    {
        AgentStatus.Pending => "PENDING",
        AgentStatus.Approved => "APPROVED",
        AgentStatus.Revoked => "REVOKED",
        _ => throw new ArgumentOutOfRangeException(nameof(status)),
    };
}
