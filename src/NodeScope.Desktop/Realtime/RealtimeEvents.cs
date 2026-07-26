using NodeScope.Desktop.Api;

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
/// A server-pushed failure (<c>v1:error</c>). The host does not emit it today because
/// the assistant's quota path never charges, but the shape
/// stays handled so a future rejection degrades to a message instead of a hung spinner.
/// </summary>
internal sealed record RealtimeErrorEvent(string Code, string Message, string? Context);

/// <summary>
/// A device changed (<c>v1:device:updated</c>): an inventory PATCH or a map/BIM placement,
/// scoped to the device's site. Creates never emit - a device unseen by this client first
/// appears here when someone edits or places it.
/// </summary>
internal sealed record DeviceUpdatedEvent(BimDevice Device);

/// <summary>A device was deleted (<c>v1:device:deleted</c>).</summary>
internal sealed record DeviceDeletedEvent(string DeviceId);

/// <summary>A circuit changed (<c>v1:circuit:updated</c>). Creates never emit, like devices.</summary>
internal sealed record CircuitUpdatedEvent(Circuit Circuit);

/// <summary>A circuit was deleted (<c>v1:circuit:deleted</c>).</summary>
internal sealed record CircuitDeletedEvent(string CircuitId);

/// <summary>
/// The scheduled per-user metrics push (<c>v1:metrics:update</c>): the caller's own latest
/// collector sample, echoed to their whole client group every REFRESH_INTERVAL_SECONDS
/// (30s on the appliance). Readings older than three cycles are dropped server-side, so
/// arrival implies freshness at push time.
/// </summary>
internal sealed record MetricsUpdateEvent(ClientMetrics Metrics, IReadOnlyList<string> SourceTypes);

/// <summary>
/// One collector cycle's readings for the <c>MetricsSubmit</c> hub method. Every field is
/// optional - a probe that failed reports nothing rather than a zero.
/// </summary>
internal sealed record MetricsSubmission(
    double? BandwidthDown,
    double? BandwidthUp,
    double? Latency,
    string? ConnectionQuality);
