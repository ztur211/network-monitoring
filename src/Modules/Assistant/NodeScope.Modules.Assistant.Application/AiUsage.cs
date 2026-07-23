using System.Globalization;
using Microsoft.Extensions.Configuration;

namespace NodeScope.Modules.Assistant.Application;

/// <summary>The user's assistant quota and what they have spent of it this period.</summary>
public sealed record AiUsageDto(
    int HourlyUsed,
    int HourlyLimit,
    int DailyUsed,
    int DailyLimit,
    int MonthlyTokensUsed,
    int MonthlyTokenBudget,
    DateTime ResetsAt);

/// <summary>
/// The assistant's quota caps, read from configuration with the Node defaults. Decision 9 moves
/// inference to the desktop client, so what remains server-side is the accounting.
/// </summary>
public sealed class AiLimits
{
    public AiLimits(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        Hourly = Read(configuration, "AI_HOURLY_LIMIT", 20);
        Daily = Read(configuration, "AI_DAILY_LIMIT", 100);
        MonthlyTokens = Read(configuration, "AI_MONTHLY_TOKEN_BUDGET", 100_000);
    }

    public int Hourly { get; }

    public int Daily { get; }

    public int MonthlyTokens { get; }

    /// <summary>Midnight UTC on the first of next month, when the token budget rolls over.</summary>
    public static DateTime NextMonthStart(DateTime now)
    {
        var utc = now.ToUniversalTime();
        return new DateTime(utc.Year, utc.Month, 1, 0, 0, 0, DateTimeKind.Utc).AddMonths(1);
    }

    private static int Read(IConfiguration configuration, string key, int fallback) =>
        int.TryParse(configuration[key], NumberStyles.Integer, CultureInfo.InvariantCulture, out var value)
            ? value
            : fallback;
}

/// <summary>
/// The per-user counters behind the quota. Node keeps them in Redis under hour/day/month keys;
/// the appliance is single-node (Decision 8), so an in-process cache with the same key shapes
/// and expiries is the same observable behaviour.
/// </summary>
public interface IAiUsageCounters
{
    public Task<(int Hourly, int Daily, int MonthlyTokens)> ReadAsync(
        string userId,
        CancellationToken cancellationToken);
}

/// <summary>The assistant's stored conversations (Node keeps them in Redis, per user).</summary>
public interface IAiConversationStore
{
    /// <summary>False when the user has no such conversation.</summary>
    public Task<bool> DeleteAsync(string userId, string conversationId, CancellationToken cancellationToken);
}

/// <summary>The assistant's HTTP surface (Node's <c>AiService</c> read + delete).</summary>
public sealed class AiService
{
    private readonly IAiUsageCounters _counters;
    private readonly IAiConversationStore _conversations;
    private readonly AiLimits _limits;

    public AiService(IAiUsageCounters counters, IAiConversationStore conversations, AiLimits limits)
    {
        _counters = counters;
        _conversations = conversations;
        _limits = limits;
    }

    public async Task<AiUsageDto> GetUsageAsync(string userId, CancellationToken cancellationToken)
    {
        var (hourly, daily, monthlyTokens) = await _counters.ReadAsync(userId, cancellationToken);
        return new AiUsageDto(
            hourly,
            _limits.Hourly,
            daily,
            _limits.Daily,
            monthlyTokens,
            _limits.MonthlyTokens,
            AiLimits.NextMonthStart(DateTime.UtcNow));
    }

    public async Task DeleteConversationAsync(
        string userId,
        string conversationId,
        CancellationToken cancellationToken)
    {
        if (!await _conversations.DeleteAsync(userId, conversationId, cancellationToken))
        {
            throw Platform.Abstractions.ApiErrors.NotFound();
        }
    }
}
