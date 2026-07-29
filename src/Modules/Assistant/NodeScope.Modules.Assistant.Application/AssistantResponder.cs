using System.Globalization;
using System.Text;
using Microsoft.Extensions.Logging;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Assistant.Application;

/// <summary>
/// The server-side graceful-degradation answer. Inference remains unavailable on the
/// appliance, but focused troubleshooting includes live, permission-filtered inventory
/// and monitoring context instead of returning a generic checklist alone.
/// </summary>
public sealed class AssistantResponder : IAssistantResponder
{
    private static readonly string GenericFallback = string.Join(
        '\n',
        "I'm temporarily unable to reach the AI service.",
        "",
        "For troubleshooting steps, verify:",
        "1. All network hardware is powered on",
        "2. Physical cable connections are secure",
        "3. Check device indicator lights for error states",
        "4. Restart devices in order: modem - router - switches - access points",
        "",
        "The AI service will be available again shortly.");

    private readonly AiService _usage;
    private readonly IAssistantDeviceContextProvider _devices;
    private readonly IAssistantTelemetryContextProvider _telemetry;
    private readonly ILogger<AssistantResponder> _logger;

    public AssistantResponder(
        AiService usage,
        IAssistantDeviceContextProvider devices,
        IAssistantTelemetryContextProvider telemetry,
        ILogger<AssistantResponder> logger)
    {
        _usage = usage;
        _devices = devices;
        _telemetry = telemetry;
        _logger = logger;
    }

    public async Task<AssistantAnswer> AnswerAsync(
        string userId,
        OrgMemberContext? member,
        string? conversationId,
        string message,
        string? focusDeviceId,
        Func<string, string, Task> onToken,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(onToken);
        var conversation = string.IsNullOrEmpty(conversationId)
            ? Guid.NewGuid().ToString()
            : conversationId;
        var content = await BuildContentAsync(member, focusDeviceId, cancellationToken);
        await onToken(content, conversation);

        var usage = await _usage.GetUsageAsync(userId, cancellationToken);
        return new AssistantAnswer(
            conversation,
            content,
            "unavailable",
            TokensUsed: 0,
            UsageWarning: null,
            Math.Max(0, usage.MonthlyTokenBudget - usage.MonthlyTokensUsed));
    }

    private async Task<string> BuildContentAsync(
        OrgMemberContext? member,
        string? focusDeviceId,
        CancellationToken cancellationToken)
    {
        if (member is null || string.IsNullOrWhiteSpace(focusDeviceId))
        {
            return GenericFallback;
        }

        AssistantDeviceContext? device;
        try
        {
            device = await _devices.FindVisibleAsync(member, focusDeviceId, cancellationToken);
        }
        catch (Exception failure) when (
            failure is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            AssistantResponderLog.ContextFailed(_logger, "inventory", failure);
            return GenericFallback;
        }

        if (device is null)
        {
            return string.Join(
                '\n',
                "I'm temporarily unable to reach the AI service.",
                "",
                "The selected device is unavailable in your current access scope.",
                "",
                "Choose a visible inventory device and try troubleshooting again.");
        }

        AssistantTelemetryContext? telemetry = null;
        try
        {
            telemetry = await _telemetry.GetAsync(
                member.OrganizationId,
                device.Id,
                cancellationToken);
        }
        catch (Exception failure) when (
            failure is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            AssistantResponderLog.ContextFailed(_logger, "monitoring", failure);
        }

        return FocusedFallback(device, telemetry);
    }

    private static string FocusedFallback(
        AssistantDeviceContext device,
        AssistantTelemetryContext? telemetry)
    {
        var output = new StringBuilder();
        output.AppendLine("I'm temporarily unable to reach the AI service.");
        output.AppendLine();
        output.Append("Focused device: ")
            .Append(SingleLine(device.Name))
            .Append(" (")
            .Append(SingleLine(device.Category))
            .AppendLine(")");
        output.Append("Address: ")
            .AppendLine(SingleLine(device.IpAddress) ?? "not documented");
        output.Append("MAC: ")
            .AppendLine(SingleLine(device.MacAddress) ?? "not documented");
        output.Append("Location: ")
            .AppendLine(Floor(device));

        if (telemetry is null)
        {
            output.AppendLine("Current status: telemetry unavailable");
        }
        else
        {
            output.Append("Current status: ").Append(SingleLine(telemetry.State));
            if (telemetry.LatencyMs is { } latency)
            {
                output.Append(
                    CultureInfo.InvariantCulture,
                    $" ({latency:F1} ms)");
            }

            output.AppendLine();
            if (telemetry.LastCheckAt is { } lastCheck)
            {
                output.Append(
                    CultureInfo.InvariantCulture,
                    $"Last check: {lastCheck.ToUniversalTime():u}");
                output.AppendLine();
            }

            if (telemetry.Metrics.Count > 0)
            {
                output.AppendLine();
                output.AppendLine("Last-hour metrics:");
                foreach (var metric in telemetry.Metrics)
                {
                    output.Append(
                        CultureInfo.InvariantCulture,
                        $"- {SingleLine(metric.Name)}: latest {metric.Latest:G4}, avg {metric.Average:G4}, range {metric.Minimum:G4}-{metric.Maximum:G4}");
                    output.AppendLine();
                }
            }

            if (telemetry.RecentStatusEvents.Count > 0)
            {
                output.AppendLine();
                output.AppendLine("Recent status changes:");
                foreach (var statusEvent in telemetry.RecentStatusEvents)
                {
                    output.Append(
                        CultureInfo.InvariantCulture,
                        $"- {statusEvent.Time.ToUniversalTime():u}: {SingleLine(statusEvent.State)}");
                    if (SingleLine(statusEvent.Source) is { } source)
                    {
                        output.Append(" via ").Append(source);
                    }

                    output.AppendLine();
                }
            }
        }

        output.AppendLine();
        output.AppendLine("Documented connections:");
        if (device.Connections.Count == 0)
        {
            output.AppendLine("- none visible");
        }
        else
        {
            foreach (var connection in device.Connections)
            {
                output.Append("- ")
                    .Append(SingleLine(connection.PeerName))
                    .Append(" via ")
                    .AppendLine(SingleLine(connection.ConnectionType));
            }

            var hidden = device.TotalConnections - device.Connections.Count;
            if (hidden > 0)
            {
                output.Append(
                    CultureInfo.InvariantCulture,
                    $"- {hidden} more connection(s) not included in this summary");
                output.AppendLine();
            }
        }

        output.AppendLine();
        output.AppendLine("Recommended checks:");
        output.AppendLine("1. Confirm power and link indicators on this device.");
        output.AppendLine("2. Verify its documented physical connections.");
        output.AppendLine("3. Compare the current state with the recent transitions above.");
        output.AppendLine("4. Check the connected upstream device before restarting equipment.");
        return output.ToString().TrimEnd();
    }

    private static string Floor(AssistantDeviceContext device)
    {
        if (SingleLine(device.FloorLabel) is { } label)
        {
            return label;
        }

        return device.Floor is { } floor
            ? string.Create(CultureInfo.InvariantCulture, $"Floor {floor}")
            : "not documented";
    }

    private static string? SingleLine(string? value)
    {
        var cleaned = value?.Replace('\r', ' ').Replace('\n', ' ').Trim();
        return string.IsNullOrEmpty(cleaned) ? null : cleaned;
    }
}

internal static partial class AssistantResponderLog
{
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "Assistant focused {ContextSource} context failed")]
    public static partial void ContextFailed(
        ILogger logger,
        string contextSource,
        Exception exception);
}
