using Microsoft.Extensions.Logging;

namespace NodeScope.Desktop;

/// <summary>Source-generated log messages for the app lifecycle (CA1848).</summary>
internal static partial class AppLog
{
    [LoggerMessage(Level = LogLevel.Information,
        Message = "NodeScope desktop client {Version} starting; logging to {LogDirectory}")]
    public static partial void Starting(ILogger logger, string version, string logDirectory);
}
