using Microsoft.Extensions.Logging;

namespace NodeScope.Desktop.Auth;

/// <summary>Source-generated log messages for the auth flow (CA1848).</summary>
internal static partial class AuthLog
{
    [LoggerMessage(Level = LogLevel.Information, Message = "Sign-in started against {ServerUrl}")]
    public static partial void SignInStarted(ILogger logger, Uri serverUrl);

    [LoggerMessage(Level = LogLevel.Information, Message = "Signed in as {Email} at {ServerUrl}")]
    public static partial void SignedIn(ILogger logger, string email, Uri serverUrl);

    [LoggerMessage(Level = LogLevel.Information, Message = "Restored session for {Email} at {ServerUrl}")]
    public static partial void SessionRestored(ILogger logger, string email, Uri serverUrl);

    [LoggerMessage(Level = LogLevel.Information, Message = "Stored session rejected by {ServerUrl}; vault cleared")]
    public static partial void StoredSessionRejected(ILogger logger, Uri serverUrl);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Could not confirm the stored session with {ServerUrl}: {Reason}")]
    public static partial void RestoreUnreachable(ILogger logger, Uri serverUrl, string reason);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Sign-in failed ({Code}): {Reason}")]
    public static partial void SignInFailed(ILogger logger, string code, string reason);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Server-side sign-out failed; signing out locally anyway: {Reason}")]
    public static partial void RevokeFailed(ILogger logger, string reason);

    [LoggerMessage(Level = LogLevel.Information, Message = "Signed out")]
    public static partial void SignedOut(ILogger logger);
}
