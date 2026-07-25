using System.Collections.Concurrent;
using NodeScope.Desktop.Hosting;
using Xunit;

namespace NodeScope.Desktop.Tests;

public sealed class SingleInstanceTests : IDisposable
{
    // UDS paths have a ~104-byte limit; keep these short and unique.
    private readonly string _socketPath = Path.Combine(
        Path.GetTempPath(), $"ns-{Guid.NewGuid():N}"[..24] + ".sock");

    public void Dispose()
    {
        if (File.Exists(_socketPath))
        {
            File.Delete(_socketPath);
        }
    }

    [Fact]
    public async Task The_primary_receives_what_a_secondary_forwards()
    {
        using var received = new BlockingCollection<string>();
        using var primary = SingleInstance.TryStartPrimary(_socketPath, received.Add);
        Assert.NotNull(primary);

        Assert.True(SingleInstance.TryForward(_socketPath, "nodescope://auth/callback?code=c&state=s"));

        var message = await Task.Run(() => received.Take(new CancellationTokenSource(5000).Token));
        Assert.Equal("nodescope://auth/callback?code=c&state=s", message);
    }

    [Fact]
    public void A_second_bind_fails_while_the_primary_lives_and_succeeds_after_disposal()
    {
        var primary = SingleInstance.TryStartPrimary(_socketPath, _ => { });
        Assert.NotNull(primary);
        Assert.Null(SingleInstance.TryStartPrimary(_socketPath, _ => { }));

        primary.Dispose();
        Assert.False(File.Exists(_socketPath)); // disposal unlinks, so the next launch binds clean

        using var successor = SingleInstance.TryStartPrimary(_socketPath, _ => { });
        Assert.NotNull(successor);
    }

    [Fact]
    public void Forwarding_with_nobody_listening_reports_false()
    {
        Assert.False(SingleInstance.TryForward(_socketPath, "activate"));

        // The stale-socket recovery path: a file exists but nothing accepts on it.
        File.WriteAllText(_socketPath, string.Empty);
        Assert.False(SingleInstance.TryForward(_socketPath, "activate"));
    }
}

public sealed class ActivationQueueTests
{
    [Fact]
    public void Messages_posted_before_subscription_drain_in_order()
    {
        var queue = new ActivationQueue();
        queue.Post("first");
        queue.Post("second");

        var seen = new List<string>();
        queue.Subscribe(seen.Add);
        queue.Post("third");

        Assert.Equal(["first", "second", "third"], seen);
    }
}

public sealed class SchemeRegistrationTests : IDisposable
{
    private readonly DirectoryInfo _scratch = Directory.CreateTempSubdirectory("nodescope-scheme-tests-");

    public void Dispose() => _scratch.Delete(recursive: true);

    [Fact]
    public void The_desktop_entry_claims_the_scheme_and_writes_idempotently()
    {
        var fileName = SchemeRegistration.WriteDesktopFileIfChanged(_scratch.FullName, "/opt/nodescope/NodeScope.Desktop");
        var path = Path.Combine(_scratch.FullName, fileName);
        var written = File.ReadAllText(path);

        Assert.Contains("MimeType=x-scheme-handler/nodescope;", written, StringComparison.Ordinal);
        Assert.Contains("Exec=/opt/nodescope/NodeScope.Desktop %u", written, StringComparison.Ordinal);
        Assert.Contains("NoDisplay=true", written, StringComparison.Ordinal);

        var before = File.GetLastWriteTimeUtc(path);
        SchemeRegistration.WriteDesktopFileIfChanged(_scratch.FullName, "/opt/nodescope/NodeScope.Desktop");
        Assert.Equal(before, File.GetLastWriteTimeUtc(path)); // unchanged content: no rewrite

        SchemeRegistration.WriteDesktopFileIfChanged(_scratch.FullName, "/elsewhere/NodeScope.Desktop");
        Assert.Contains("Exec=/elsewhere/NodeScope.Desktop %u",
            File.ReadAllText(path), StringComparison.Ordinal); // moved binary: rewritten
    }
}
