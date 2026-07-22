namespace NodeScope.Agent;

internal static class AgentCycle
{
    /// <summary>
    /// One probe cycle: sync the device list, run every collector over the fleet, enqueue
    /// the results as server-sized chunks, drain the buffer, and always heartbeat.
    /// </summary>
    public static async Task RunAsync(
        IAgentApiClient client,
        IngestBuffer buffer,
        Func<string, CancellationToken, Task<ProbeResult>> probe,
        int concurrency,
        SnmpSessionFactory snmpFactory,
        CancellationToken cancellationToken)
    {
        var devices = await client.SyncDevicesAsync(cancellationToken);
        var collectors = new List<ICollector>
        {
            new ReachabilityCollector(probe),
            new SnmpCollector(snmpFactory),
        };
        var batch = await DevicePoller.PollAsync(devices, collectors, concurrency, cancellationToken);

        // One cycle polls the WHOLE fleet, so this batch grows with the customer. Enqueue it as
        // server-sized chunks instead of one unbounded request that the API would (rightly)
        // refuse. Chunks are queued individually, so a partial failure only ever costs the
        // chunks that failed.
        foreach (var chunk in IngestBatching.Chunk(batch, IngestBatching.MaxItemsPerBatch))
        {
            buffer.Enqueue(chunk);
        }

        // Liveness must not be coupled to data delivery: DrainAsync re-throws on a transient
        // ingest failure (5xx/429/network), but the heartbeat must still go out or the backend
        // starts marking a healthy agent offline. Run it in finally so a failed drain can't
        // skip it.
        try
        {
            await buffer.DrainAsync(b => client.IngestAsync(b, cancellationToken));
        }
        finally
        {
            await client.HeartbeatAsync(cancellationToken);
        }
    }
}
