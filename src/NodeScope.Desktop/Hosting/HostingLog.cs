using Microsoft.Extensions.Logging;

namespace NodeScope.Desktop.Hosting;

/// <summary>Source-generated log messages for process hosting concerns (CA1848).</summary>
internal static partial class HostingLog
{
    [LoggerMessage(Level = LogLevel.Information, Message = "nodescope:// handler registered for {ExePath}")]
    public static partial void SchemeRegistered(ILogger logger, string exePath);

    [LoggerMessage(Level = LogLevel.Warning, Message = "nodescope:// handler registration failed: {Reason}")]
    public static partial void SchemeRegistrationFailed(ILogger logger, string reason);

    [LoggerMessage(Level = LogLevel.Information, Message = "Activation received from another instance")]
    public static partial void ActivationReceived(ILogger logger);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Activation listener reset after an error: {Reason}")]
    public static partial void ActivationListenerReset(ILogger logger, string reason);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Activation message ignored (not a callback or activate): {Message}")]
    public static partial void ActivationIgnored(ILogger logger, string message);

    [LoggerMessage(Level = LogLevel.Error, Message = "Session restore crashed unexpectedly")]
    public static partial void RestoreCrashed(ILogger logger, Exception exception);
}
