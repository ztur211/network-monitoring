using Microsoft.Extensions.Logging;
using NodeScope.Desktop.Logging;
using Xunit;

namespace NodeScope.Desktop.Tests;

public sealed class FileLoggerProviderTests : IDisposable
{
    private readonly DirectoryInfo _scratch =
        Directory.CreateTempSubdirectory("nodescope-filelogger-tests-");

    private readonly FixedTimeProvider _clock = new(
        new DateTimeOffset(2026, 7, 25, 10, 0, 0, TimeSpan.Zero));

    public void Dispose() => _scratch.Delete(recursive: true);

    [Fact]
    public void Write_appends_a_line_with_timestamp_level_and_category()
    {
        using (var provider = new FileLoggerProvider(_scratch.FullName, _clock))
        {
            provider.Write("Test.Category", LogLevel.Information, "hello world", null);
        }

        var line = File.ReadAllText(LogPath("20260725"));
        Assert.Equal("2026-07-25 10:00:00.000 INF Test.Category: hello world" + Environment.NewLine, line);
    }

    [Fact]
    public void Exceptions_are_written_on_the_following_lines()
    {
        using (var provider = new FileLoggerProvider(_scratch.FullName, _clock))
        {
            provider.Write("Test", LogLevel.Error, "boom",
                new InvalidOperationException("the detail"));
        }

        var content = File.ReadAllText(LogPath("20260725"));
        Assert.Contains("ERR Test: boom", content, StringComparison.Ordinal);
        Assert.Contains("System.InvalidOperationException: the detail", content, StringComparison.Ordinal);
    }

    [Fact]
    public void The_file_rolls_when_the_local_date_changes()
    {
        using (var provider = new FileLoggerProvider(_scratch.FullName, _clock))
        {
            provider.Write("Test", LogLevel.Information, "before midnight", null);
            _clock.Now = _clock.Now.AddDays(1);
            provider.Write("Test", LogLevel.Information, "after midnight", null);
        }

        Assert.Contains("before midnight", File.ReadAllText(LogPath("20260725")), StringComparison.Ordinal);
        Assert.Contains("after midnight", File.ReadAllText(LogPath("20260726")), StringComparison.Ordinal);
    }

    [Fact]
    public void Rolling_prunes_to_the_newest_fourteen_files()
    {
        for (var day = 1; day <= 20; day++)
        {
            File.WriteAllText(LogPath($"202601{day:00}"), "old");
        }

        using (var provider = new FileLoggerProvider(_scratch.FullName, _clock))
        {
            provider.Write("Test", LogLevel.Information, "current", null);
        }

        var remaining = Directory.GetFiles(_scratch.FullName, "desktop-*.log");
        Assert.Equal(14, remaining.Length);
        Assert.Contains(LogPath("20260725"), remaining);
        // The oldest pre-existing files are the ones that went.
        Assert.DoesNotContain(LogPath("20260101"), remaining);
    }

    [Fact]
    public void A_sink_that_cannot_write_disables_itself_instead_of_throwing()
    {
        // A FILE at the directory path makes CreateDirectory throw IOException.
        var blocked = Path.Combine(_scratch.FullName, "not-a-directory");
        File.WriteAllText(blocked, string.Empty);

        using var provider = new FileLoggerProvider(blocked, _clock);
        provider.Write("Test", LogLevel.Information, "first attempt", null);
        provider.Write("Test", LogLevel.Information, "second attempt", null);
    }

    [Fact]
    public void The_ilogger_facade_formats_state_and_respects_none()
    {
        using (var provider = new FileLoggerProvider(_scratch.FullName, _clock))
        {
            var logger = provider.CreateLogger("Facade");

            Assert.False(logger.IsEnabled(LogLevel.None));
            Assert.Null(logger.BeginScope("scope"));

            logger.Log(LogLevel.Warning, default, "formatted state", null,
                static (state, _) => state);
        }

        Assert.Contains("WRN Facade: formatted state",
            File.ReadAllText(LogPath("20260725")), StringComparison.Ordinal);
    }

    private string LogPath(string stamp) =>
        Path.Combine(_scratch.FullName, $"desktop-{stamp}.log");

    /// <summary>Settable clock pinned to UTC so the roll-over date is deterministic.</summary>
    private sealed class FixedTimeProvider(DateTimeOffset start) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = start;

        public override DateTimeOffset GetUtcNow() => Now.ToUniversalTime();

        public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.Utc;
    }
}
