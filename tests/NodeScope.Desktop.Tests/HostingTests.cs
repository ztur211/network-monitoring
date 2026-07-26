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

        Assert.True(SingleInstance.TryForward(_socketPath, SingleInstance.ActivateMessage));

        var message = await Task.Run(() => received.Take(new CancellationTokenSource(5000).Token));
        Assert.Equal(SingleInstance.ActivateMessage, message);
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

