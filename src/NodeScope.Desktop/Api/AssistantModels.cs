namespace NodeScope.Desktop.Api;

/// <summary>
/// The caller's assistant quota and what they have spent of it (<c>GET /api/v1/ai/usage</c>).
/// Counters only move when inference charges, which the Decision 9 host never does - the
/// section still renders them because the web did and the wire keeps serving them.
/// </summary>
internal sealed record AiUsage(
    int HourlyUsed,
    int HourlyLimit,
    int DailyUsed,
    int DailyLimit,
    int MonthlyTokensUsed,
    int MonthlyTokenBudget,
    DateTime ResetsAt);
