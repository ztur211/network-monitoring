using Microsoft.Extensions.Logging;

namespace NodeScope.Desktop.Logging;

/// <summary>Category-bound facade over <see cref="FileLoggerProvider"/>; all state lives there.</summary>
internal sealed class FileLogger(FileLoggerProvider provider, string category) : ILogger
{
    public IDisposable? BeginScope<TState>(TState state)
        where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;

    public void Log<TState>(
        LogLevel logLevel,
        EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter)
    {
        ArgumentNullException.ThrowIfNull(formatter);
        if (!IsEnabled(logLevel))
        {
            return;
        }

        provider.Write(category, logLevel, formatter(state, exception), exception);
    }
}
