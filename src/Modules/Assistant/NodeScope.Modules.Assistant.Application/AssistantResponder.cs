using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Assistant.Application;

/// <summary>
/// The assistant's answer. Decision 9 moved inference to the desktop client, so the server has
/// no provider to call and always takes the graceful-degradation path the Node service used
/// when its provider was unreachable: one token carrying the whole reply, then a completion
/// marked unavailable with nothing charged. The wire shape is identical either way, which is
/// what lets the client stay unchanged when inference moves.
/// </summary>
public sealed class AssistantResponder : IAssistantResponder
{
    private static readonly string Fallback = string.Join(
        '\n',
        "I'm temporarily unable to reach the AI service.",
        "",
        "Based on your documented network:",
        "No devices documented yet.",
        "",
        "For troubleshooting steps, verify:",
        "1. All network hardware is powered on",
        "2. Physical cable connections are secure",
        "3. Check device indicator lights for error states",
        "4. Restart devices in order: modem - router - switches - access points",
        "",
        "The AI service will be available again shortly.");

    private readonly AiService _usage;

    public AssistantResponder(AiService usage)
    {
        _usage = usage;
    }

    public async Task<AssistantAnswer> AnswerAsync(
        string userId,
        string? conversationId,
        string message,
        Func<string, string, Task> onToken,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(onToken);
        var conversation = string.IsNullOrEmpty(conversationId) ? Guid.NewGuid().ToString() : conversationId;
        await onToken(Fallback, conversation);

        var usage = await _usage.GetUsageAsync(userId, cancellationToken);
        return new AssistantAnswer(
            conversation,
            Fallback,
            "unavailable",
            TokensUsed: 0,
            // No warning and no charge: nothing was spent, so there is nothing to warn about.
            UsageWarning: null,
            Math.Max(0, usage.MonthlyTokenBudget - usage.MonthlyTokensUsed));
    }
}
