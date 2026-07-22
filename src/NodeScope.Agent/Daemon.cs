using System.Diagnostics;
using System.Runtime.InteropServices;

namespace NodeScope.Agent;

internal static class Daemon
{
    private static readonly TimeSpan HttpTimeout = TimeSpan.FromSeconds(30);

    public static async Task<int> RunAsync()
    {
        var config = AgentConfigLoader.Load();
        var credentialsPath = Environment.GetEnvironmentVariable("NODESCOPE_AGENT_CREDENTIALS")
            ?? "/etc/nodescope-agent/credentials.json";

        using var http = new HttpClient { Timeout = HttpTimeout };

        var credentials = CredentialsStore.Load(credentialsPath);
        if (credentials is null && Environment.GetEnvironmentVariable("NODESCOPE_AGENT_ENROLL_CODE") is { } code)
        {
            credentials = await Enrollment.EnrollAsync(http, new EnrollOptions
            {
                ApiUrl = config.ApiUrl,
                Code = code,
                Name = Environment.MachineName,
                Platform = Cli.PlatformName(),
                Version = AgentVersion.Value,
            });
            CredentialsStore.Save(credentialsPath, credentials);
        }

        if (credentials is null)
        {
            await Console.Error.WriteLineAsync(
                "Not enrolled: provide NODESCOPE_AGENT_ENROLL_CODE or run `nodescope-agent enroll`");
            return 1;
        }

        IAgentApiClient client = new AgentApiClient(http, config.ApiUrl, credentials.Token);
        // The device list changes rarely and each sync forces a server-side SNMP-credential
        // decrypt, so fetch it on the slower sync cadence rather than every probe cycle.
        client = new CachedSyncApiClient(client, config.SyncIntervalMs);

        var buffer = new IngestBuffer(
            Environment.GetEnvironmentVariable("NODESCOPE_AGENT_QUEUE") ?? "/var/lib/nodescope-agent/queue.jsonl",
            maxItems: 5000);
        var prober = new DeviceProber(config.IcmpEnabled, config.Ports, config.TimeoutMs);
        SnmpSessionFactory snmpFactory = static (target, host) => new SharpSnmpSession(target, host);

        using var shutdown = new CancellationTokenSource();
        using var sigterm = PosixSignalRegistration.Create(PosixSignal.SIGTERM, context =>
        {
            context.Cancel = true;
            shutdown.Cancel();
        });
        using var sigint = PosixSignalRegistration.Create(PosixSignal.SIGINT, context =>
        {
            context.Cancel = true;
            shutdown.Cancel();
        });

        var interval = TimeSpan.FromMilliseconds(config.ProbeIntervalMs);
        using var timer = new PeriodicTimer(interval);

        // Cycles run strictly serially: the next tick is not awaited until the current cycle
        // finishes, and PeriodicTimer coalesces missed ticks. That is the same containment the
        // Node agent's nonOverlapping wrapper provided - overlapping cycles pile up sockets and
        // in-flight batches without bound, and two concurrent drains would double-send the head
        // batch. The overrun warning preserves the honest signal that probing has fallen behind
        // the configured cadence.
        while (!shutdown.IsCancellationRequested)
        {
            var started = Stopwatch.GetTimestamp();
            try
            {
                await AgentCycle.RunAsync(client, buffer, prober.ProbeAsync, config.Concurrency, snmpFactory, shutdown.Token);
            }
            catch (OperationCanceledException) when (shutdown.IsCancellationRequested)
            {
                break;
            }
#pragma warning disable CA1031 // The daemon must outlive any single failed cycle; the error is reported, the loop continues.
            catch (Exception e)
#pragma warning restore CA1031
            {
                await Console.Error.WriteLineAsync($"[agent] cycle error: {e}");
            }

            var elapsed = Stopwatch.GetElapsedTime(started);
            if (elapsed > interval)
            {
                await Console.Error.WriteLineAsync(
                    $"[agent] probe cycle took {elapsed.TotalMilliseconds:F0}ms, over the {interval.TotalMilliseconds:F0}ms interval - skipping missed ticks");
            }

            try
            {
                if (!await timer.WaitForNextTickAsync(shutdown.Token))
                {
                    break;
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        // Best-effort final drain so a clean shutdown does not strand buffered samples.
        try
        {
            await buffer.DrainAsync(b => client.IngestAsync(b, CancellationToken.None));
        }
#pragma warning disable CA1031 // Shutdown is best-effort by design; the queue file preserves anything undelivered.
        catch (Exception)
#pragma warning restore CA1031
        {
        }

        return 0;
    }
}

/// <summary>Decorates <see cref="IAgentApiClient"/> so device syncs hit the API on the slower sync cadence.</summary>
internal sealed class CachedSyncApiClient : IAgentApiClient
{
    private readonly IAgentApiClient _inner;
    private readonly CachedFetch<IReadOnlyList<NodeScope.Contracts.Monitoring.AgentDeviceDto>> _devices;

    public CachedSyncApiClient(IAgentApiClient inner, long intervalMs, Func<long>? nowMs = null)
    {
        _inner = inner;
        _devices = new CachedFetch<IReadOnlyList<NodeScope.Contracts.Monitoring.AgentDeviceDto>>(
            () => inner.SyncDevicesAsync(CancellationToken.None), intervalMs, nowMs);
    }

    public Task<IReadOnlyList<NodeScope.Contracts.Monitoring.AgentDeviceDto>> SyncDevicesAsync(
        CancellationToken cancellationToken) => _devices.GetAsync();

    public Task IngestAsync(NodeScope.Contracts.Monitoring.IngestBatchDto batch, CancellationToken cancellationToken) =>
        _inner.IngestAsync(batch, cancellationToken);

    public Task HeartbeatAsync(CancellationToken cancellationToken) => _inner.HeartbeatAsync(cancellationToken);
}
