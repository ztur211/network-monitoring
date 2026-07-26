namespace NodeScope.Desktop.Realtime;

/// <summary>One streamed piece of an assistant answer (<c>v1:ai:token</c>).</summary>
internal sealed record AiTokenEvent(string Token, string ConversationId);

/// <summary>
/// The finished assistant answer (<c>v1:ai:complete</c>). <see cref="Content"/> repeats the
/// streamed tokens verbatim, so a client that missed tokens still renders the whole answer.
/// </summary>
internal sealed record AiCompleteEvent(
    string Content,
    string ConversationId,
    int TokensUsed,
    int MonthlyBudgetRemaining,
    string? UsageWarning,
    string ProviderStatus,
    string Timestamp);

/// <summary>
/// A server-pushed failure (<c>v1:error</c>), the Node gateway's rejection channel. The C#
/// host does not emit it today - the assistant's quota path never charges - but the shape
/// stays handled so a future rejection degrades to a message instead of a hung spinner.
/// </summary>
internal sealed record RealtimeErrorEvent(string Code, string Message, string? Context);
