using NodeScope.ContractTests.Inventory;

namespace NodeScope.ContractTests.Realtime;

/// <summary>
/// Contract for the realtime surface behind the transport-agnostic
/// <see cref="IRealtimeClient"/> (Decision 4). Parity here is asserted on semantics -
/// which event fires, with which payload, to which subscribers - not on the wire, so the
/// same tests carry from socket.io (Node) to SignalR (C#) by swapping the client impl.
/// This first slice proves the adapter end to end: cookie-authenticated connect, both
/// server-to-client fan-out modes (scoped entity events and the owner-room network event),
/// the client-to-server ping/pong round-trip, and - the load-bearing one - that events do
/// not cross the org boundary. Each test provisions its own isolated org(s).
/// </summary>
[Collection(ContractSuite.Name)]
public class RealtimeContractTests
{
    private static readonly TimeSpan NegativeWindow = TimeSpan.FromSeconds(2);

    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public RealtimeContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Owner_socket_receives_device_updated_when_a_device_is_patched()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var scaffold = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerCookie);
        var device = await InventoryScaffold.CreateDeviceAsync(_api, org.OwnerCookie, scaffold.NetworkId, scaffold.SiteId);
        var deviceId = InventoryScaffold.RequireId(device);
        var newName = $"rt-{Guid.NewGuid():N}";

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerCookie);

        await PatchDeviceNameAsync(deviceId, device.GetProperty("version").GetInt32(), newName, org.OwnerCookie);

        var evt = await socket.WaitForEventAsync("v1:device:updated", p => DeviceIdIs(p, deviceId));
        Assert.Equal(newName, evt.GetProperty("device").GetProperty("name").GetString());
        Assert.True(evt.TryGetProperty("changes", out _));
        Assert.True(evt.TryGetProperty("timestamp", out _));
    }

    [Fact]
    public async Task Owner_socket_receives_device_deleted_when_a_device_is_deleted()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var scaffold = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerCookie);
        var device = await InventoryScaffold.CreateDeviceAsync(_api, org.OwnerCookie, scaffold.NetworkId, scaffold.SiteId);
        var deviceId = InventoryScaffold.RequireId(device);

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerCookie);

        var deleted = await _api.DeleteAsync($"v1/devices/{deviceId}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, deleted.Status);

        var evt = await socket.WaitForEventAsync("v1:device:deleted", p => DeviceIdIs(p, deviceId));
        Assert.Equal(deviceId, evt.GetProperty("deviceId").GetString());
    }

    [Fact]
    public async Task Owner_socket_receives_circuit_updated_when_a_circuit_is_patched()
    {
        var org = await _fixture.ProvisionOrgAsync();
        // A device-less circuit governs no site; the scoped emit still reaches the owner
        // room, which is what an OWNER socket subscribes to.
        var circuit = await CreateDevicelessCircuitAsync(org.OwnerCookie);
        var circuitId = InventoryScaffold.RequireId(circuit);
        var newNotes = $"rt-{Guid.NewGuid():N}";

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerCookie);

        await PatchNotesAsync($"v1/circuits/{circuitId}", circuit.GetProperty("version").GetInt32(), newNotes, org.OwnerCookie);

        var evt = await socket.WaitForEventAsync(
            "v1:circuit:updated",
            p => p.TryGetProperty("circuitId", out var c) && c.GetString() == circuitId);
        Assert.Equal(newNotes, evt.GetProperty("circuit").GetProperty("notes").GetString());
        Assert.True(evt.TryGetProperty("changes", out _));
        Assert.True(evt.TryGetProperty("timestamp", out _));
    }

    [Fact]
    public async Task Owner_socket_receives_circuit_deleted_when_a_circuit_is_deleted()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var circuit = await CreateDevicelessCircuitAsync(org.OwnerCookie);
        var circuitId = InventoryScaffold.RequireId(circuit);

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerCookie);

        var deleted = await _api.DeleteAsync($"v1/circuits/{circuitId}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, deleted.Status);

        var evt = await socket.WaitForEventAsync(
            "v1:circuit:deleted",
            p => p.TryGetProperty("circuitId", out var c) && c.GetString() == circuitId);
        Assert.Equal(circuitId, evt.GetProperty("circuitId").GetString());
    }

    [Fact]
    public async Task Owner_socket_receives_fiber_run_updated_when_a_fiber_run_is_patched()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var scaffold = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerCookie);
        var run = await CreateFiberRunAsync(org.OwnerCookie, scaffold.NetworkId, scaffold.SiteId);
        var fiberRunId = InventoryScaffold.RequireId(run);
        var newNotes = $"rt-{Guid.NewGuid():N}";

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerCookie);

        await PatchNotesAsync($"v1/fiber-runs/{fiberRunId}", run.GetProperty("version").GetInt32(), newNotes, org.OwnerCookie);

        var evt = await socket.WaitForEventAsync(
            "v1:fiber-run:updated",
            p => p.TryGetProperty("fiberRunId", out var f) && f.GetString() == fiberRunId);
        Assert.Equal(newNotes, evt.GetProperty("fiberRun").GetProperty("notes").GetString());
        Assert.True(evt.TryGetProperty("changes", out _));
        Assert.True(evt.TryGetProperty("timestamp", out _));
    }

    [Fact]
    public async Task Owner_socket_receives_fiber_run_deleted_when_a_fiber_run_is_deleted()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var scaffold = await InventoryScaffold.CharteredSiteAsync(_api, org.OwnerCookie);
        var run = await CreateFiberRunAsync(org.OwnerCookie, scaffold.NetworkId, scaffold.SiteId);
        var fiberRunId = InventoryScaffold.RequireId(run);

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerCookie);

        var deleted = await _api.DeleteAsync($"v1/fiber-runs/{fiberRunId}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, deleted.Status);

        var evt = await socket.WaitForEventAsync(
            "v1:fiber-run:deleted",
            p => p.TryGetProperty("fiberRunId", out var f) && f.GetString() == fiberRunId);
        Assert.Equal(fiberRunId, evt.GetProperty("fiberRunId").GetString());
    }

    [Fact]
    public async Task Owner_socket_receives_network_updated_when_a_network_is_created()
    {
        // The org has no network yet; creating the first one fans out to the owner room
        // (no charters => governing-site list is empty => OWNER-only).
        var org = await _fixture.ProvisionOrgAsync();
        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerCookie);

        var network = await InventoryScaffold.CreateNetworkAsync(_api, org.OwnerCookie);
        var networkId = InventoryScaffold.RequireId(network);

        var evt = await socket.WaitForEventAsync(
            "v1:network:updated",
            p => p.TryGetProperty("networkId", out var n) && n.GetString() == networkId);
        Assert.Equal(networkId, evt.GetProperty("network").GetProperty("id").GetString());
    }

    [Fact]
    public async Task Owner_socket_receives_property_created_when_a_property_is_created()
    {
        var org = await _fixture.ProvisionOrgAsync();
        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerCookie);

        var site = await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerCookie, "SITE");
        var siteId = InventoryScaffold.RequireId(site);

        var evt = await socket.WaitForEventAsync(
            "v1:property:created",
            p => p.TryGetProperty("id", out var id) && id.GetString() == siteId);
        Assert.Equal(siteId, evt.GetProperty("id").GetString());
    }

    [Fact]
    public async Task Ping_is_answered_with_a_pong()
    {
        var org = await _fixture.ProvisionOrgAsync();
        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerCookie);

        await socket.EmitAsync("v1:ping");

        // The round-trip completing (no timeout) is the assertion; the pong carries a null body.
        var pong = await socket.WaitForEventAsync("v1:pong");
        Assert.Contains(pong.ValueKind, new[] { JsonValueKind.Null, JsonValueKind.Undefined });
    }

    [Fact]
    public async Task Events_do_not_cross_the_org_boundary()
    {
        var orgA = await _fixture.ProvisionOrgAsync();
        var scaffoldA = await InventoryScaffold.CharteredSiteAsync(_api, orgA.OwnerCookie);
        var deviceA = await InventoryScaffold.CreateDeviceAsync(_api, orgA.OwnerCookie, scaffoldA.NetworkId, scaffoldA.SiteId);
        var deviceAId = InventoryScaffold.RequireId(deviceA);

        var orgB = await _fixture.ProvisionOrgAsync();
        var scaffoldB = await InventoryScaffold.CharteredSiteAsync(_api, orgB.OwnerCookie);
        var deviceB = await InventoryScaffold.CreateDeviceAsync(_api, orgB.OwnerCookie, scaffoldB.NetworkId, scaffoldB.SiteId);
        var deviceBId = InventoryScaffold.RequireId(deviceB);

        await using var socketB = await RealtimeScaffold.ConnectReadyAsync(orgB.OwnerCookie);

        // Mutate org A's device first (B must never see it), then org B's own device.
        await PatchDeviceNameAsync(deviceAId, deviceA.GetProperty("version").GetInt32(), $"rt-a-{Guid.NewGuid():N}", orgA.OwnerCookie);
        await PatchDeviceNameAsync(deviceBId, deviceB.GetProperty("version").GetInt32(), $"rt-b-{Guid.NewGuid():N}", orgB.OwnerCookie);

        // B receives its own device's event (proves the socket is live and delivering)...
        var own = await socketB.WaitForEventAsync("v1:device:updated", p => DeviceIdIs(p, deviceBId));
        Assert.Equal(deviceBId, own.GetProperty("deviceId").GetString());

        // ...but org A's never arrives, even though it was emitted first on the wire.
        await Assert.ThrowsAsync<TimeoutException>(
            () => socketB.WaitForEventAsync("v1:device:updated", p => DeviceIdIs(p, deviceAId), NegativeWindow));
    }

    [Fact]
    public async Task Unauthenticated_socket_is_rejected()
    {
        await using var socket = new SocketIoRealtimeClient(new Uri(TestConfig.BaseUrl));

        // The transport connects, then the gateway resolves no session and disconnects it.
        await socket.ConnectAsync(auth: null);
        await socket.WaitForDisconnectAsync(TimeSpan.FromSeconds(5));

        Assert.False(socket.Connected);
    }

    private static bool DeviceIdIs(JsonElement payload, string deviceId) =>
        payload.TryGetProperty("deviceId", out var d) && d.GetString() == deviceId;

    private async Task PatchDeviceNameAsync(string deviceId, int baseVersion, string newName, Auth auth)
    {
        var patch = await _api.PatchAsync(
            $"v1/devices/{deviceId}",
            new
            {
                baseVersion,
                changes = new[] { new { field = "name", oldValue = (string?)null, newValue = newName } },
            },
            auth);
        Assert.Equal(HttpStatusCode.OK, patch.Status);
    }

    /// <summary>Patches the <c>notes</c> field of any versioned resource at <paramref name="path"/>.</summary>
    private async Task PatchNotesAsync(string path, int baseVersion, string newNotes, Auth auth)
    {
        var patch = await _api.PatchAsync(
            path,
            new
            {
                baseVersion,
                changes = new[] { new { field = "notes", oldValue = (string?)null, newValue = newNotes } },
            },
            auth);
        Assert.Equal(HttpStatusCode.OK, patch.Status);
    }

    private async Task<JsonElement> CreateDevicelessCircuitAsync(Auth auth)
    {
        var response = await _api.PostAsync(
            "v1/circuits",
            new { ispName = "Acme Fiber", serviceType = "DIA" },
            auth);
        Assert.Equal(HttpStatusCode.Created, response.Status);
        return response.Data;
    }

    private async Task<JsonElement> CreateFiberRunAsync(Auth auth, string networkId, string siteId)
    {
        // A fiber run links two distinct devices; both sit on the chartered site so their
        // governing-site resolution and the emit's scope both land in the owner room.
        var start = await InventoryScaffold.CreateDeviceAsync(_api, auth, networkId, siteId);
        var end = await InventoryScaffold.CreateDeviceAsync(_api, auth, networkId, siteId);

        var response = await _api.PostAsync(
            "v1/fiber-runs",
            new
            {
                name = $"run-{Guid.NewGuid():N}",
                startDeviceId = InventoryScaffold.RequireId(start),
                endDeviceId = InventoryScaffold.RequireId(end),
            },
            auth);
        Assert.Equal(HttpStatusCode.Created, response.Status);
        return response.Data;
    }
}
