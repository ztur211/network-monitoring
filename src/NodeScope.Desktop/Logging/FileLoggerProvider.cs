using System.Globalization;
using Microsoft.Extensions.Logging;

namespace NodeScope.Desktop.Logging;

/// <summary>
/// Decision 19's desktop sink: a daily-rolling log file in app data, first-party MEL only
/// (Serilog was rejected as a redundant third-party layer).
/// </summary>
/// <remarks>
/// Deliberately small: one file per local day (<c>desktop-yyyyMMdd.log</c>), the newest
/// <see cref="RetainedFiles"/> files kept, writes serialized under one lock with
/// auto-flush so a crash loses at most the line being written. A sink that cannot write
/// (locked file, revoked permissions, full disk) disables itself rather than taking the
/// client down - the log is diagnostics, not product state. The clock is injectable so
/// the roll-over is testable without waiting for midnight.
/// </remarks>
internal sealed class FileLoggerProvider(string directory, TimeProvider? timeProvider = null) : ILoggerProvider
{
    private const int RetainedFiles = 14;

    private readonly TimeProvider _time = timeProvider ?? TimeProvider.System;
    private readonly Lock _sync = new();
    private StreamWriter? _writer;
    private DateOnly _writerDate;
    private bool _disabled;

    public ILogger CreateLogger(string categoryName) => new FileLogger(this, categoryName);

    public void Dispose()
    {
        lock (_sync)
        {
            _writer?.Dispose();
            _writer = null;
            _disabled = true;
        }
    }

    internal void Write(string category, LogLevel level, string message, Exception? exception)
    {
        var now = _time.GetLocalNow();

        lock (_sync)
        {
            if (_disabled)
            {
                return;
            }

            try
            {
                EnsureWriter(DateOnly.FromDateTime(now.DateTime));
                _writer!.Write(now.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture));
                _writer.Write(' ');
                _writer.Write(LevelLabel(level));
                _writer.Write(' ');
                _writer.Write(category);
                _writer.Write(": ");
                _writer.WriteLine(message);
                if (exception is not null)
                {
                    _writer.WriteLine(exception.ToString());
                }
            }
            catch (Exception failure) when (failure is IOException or UnauthorizedAccessException)
            {
                _disabled = true;
                _writer?.Dispose();
                _writer = null;
            }
        }
    }

    private void EnsureWriter(DateOnly date)
    {
        if (_writer is not null && _writerDate == date)
        {
            return;
        }

        _writer?.Dispose();
        Directory.CreateDirectory(directory);
        var name = "desktop-" + date.ToString("yyyyMMdd", CultureInfo.InvariantCulture) + ".log";
        _writer = new StreamWriter(Path.Combine(directory, name), append: true) { AutoFlush = true };
        _writerDate = date;
        Prune();
    }

    /// <summary>Keeps the newest <see cref="RetainedFiles"/> files; name order is date order.</summary>
    private void Prune()
    {
        var files = Directory.GetFiles(directory, "desktop-*.log");
        if (files.Length <= RetainedFiles)
        {
            return;
        }

        Array.Sort(files, StringComparer.Ordinal);
        foreach (var stale in files[..^RetainedFiles])
        {
            try
            {
                File.Delete(stale);
            }
            catch (IOException)
            {
                // A held-open stale file postpones its deletion to the next roll, nothing more.
            }
        }
    }

    private static string LevelLabel(LogLevel level) => level switch
    {
        LogLevel.Trace => "TRC",
        LogLevel.Debug => "DBG",
        LogLevel.Information => "INF",
        LogLevel.Warning => "WRN",
        LogLevel.Error => "ERR",
        LogLevel.Critical => "CRT",
        _ => "???",
    };
}
