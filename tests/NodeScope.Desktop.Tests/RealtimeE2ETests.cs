using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Auth;
using NodeScope.Desktop.Realtime;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// The realtime milestone live, end to end: a real PKCE sign-in, a real SignalR
/// connection, and the three consumer loops against the appliance - an out-of-band
/// REST edit landing in the equipment list as a <c>v1:device:updated</c> delta (the
/// created device is UNSEEN by the list, so this also proves the append path), the
/// delete echo removing it, and one submitted metrics sample coming back on the
/// scheduled <c>v1:metrics:update</c> push into the clients tab. The push cadence is
/// the appliance's REFRESH_INTERVAL_SECONDS (default 30s), so the metrics half waits
/// out one full cycle.
/// </summary>
/// <remarks>
/// Env-gated like the other live E2Es:
/// <c>NODESCOPE_DESKTOP_REALTIME_E2E_BASE_URL=http://localhost:8080</c> against the
/// appliance stack + demo seed.
/// </remarks>
public sealed class RealtimeE2ETests : IDisposable
{
    private readonly DirectoryInfo _scratch = Directory.CreateTempSubdirectory("nodescope-realtime-e2e-");

    public void Dispose() => _scratch.Delete(recursive: true);

    [Fact]
    public async Task Entity_deltas_and_the_metrics_loop_flow_over_the_live_wire()
    {
        if (OperatingSystem.IsWindows())
        {
            Assert.Skip("the E2E drives the Linux dev-loop vault; Windows runs use DPAPI");
            return;
        }

        var configured = Environment.GetEnvironmentVariable("NODESCOPE_DESKTOP_REALTIME_E2E_BASE_URL");
        Assert.SkipWhen(string.IsNullOrEmpty(configured),
            "set NODESCOPE_DESKTOP_REALTIME_E2E_BASE_URL (appliance stack + demo seed) to run");

        var server = new Uri(configured);
        var email = Environment.GetEnvironmentVariable("NODESCOPE_DESKTOP_REALTIME_E2E_EMAIL") ?? "owner@acme.test";
        var password = Environment.GetEnvironmentVariable("NODESCOPE_DESKTOP_REALTIME_E2E_PASSWORD") ?? "devpassword123";

        var vault = new PlainFileTokenVault(Path.Combine(_scratch.FullName, "vault.json"));
        var settingsStore = new SettingsStore(Path.Combine(_scratch.FullName, "settings.json"));
        using var browser = new SignInBrowser(server);
        using var factory = new ApplianceClientFactory();
        using var flow = new DesktopAuthFlow(
            factory, vault, settingsStore, browser, NullLogger<DesktopAuthFlow>.Instance);

        await browser.SignInAsync(email, password);
        flow.StartSignIn(server);
        await flow.HandleCallbackAsync(await browser.CompleteAuthorizeAsync(), CancellationToken.None);
        Assert.Equal(SessionPhase.SignedIn, flow.Current.Phase);
        var session = flow.Session!;

        // The production connection with an inline post: the test thread polls, so
        // handlers may run on the transport thread directly.
        using var realtime = new RealtimeConnection(
            server, session.Token, NullLogger.Instance, action => action());
        realtime.Start();
        await realtime.Connecting.WaitAsync(
            TimeSpan.FromSeconds(20), TestContext.Current.CancellationToken);

        // The hub answers a ping - the collector's latency probe in miniature.
        var roundTrip = await realtime.PingAsync(TestContext.Current.CancellationToken);
        Assert.True(roundTrip > TimeSpan.Zero);

        using var equipment = new EquipmentViewModel(session, realtime, NullLogger.Instance);
        await equipment.Initialization;
        Assert.Null(equipment.LoadError);
        Assert.NotEmpty(equipment.Rows);

        // Create out of band on a chartered property (one a seeded device lives on).
        // Creates never emit, so the list must NOT see it yet - the first PATCH is
        // what pushes it in, exercising the unseen-id append path.
        var template = equipment.Devices[0];
        var marker = $"rt-e2e-{Guid.NewGuid():N}";
        var created = await session.Client.CreateDeviceAsync(
            session.Token,
            new CreateDevice(
                marker, "SWITCH", template.NetworkId, template.PropertyId,
                null, null, null, null, null, null, null),
            TestContext.Current.CancellationToken);
        try
        {
            Assert.DoesNotContain(equipment.Rows, row => row.Device.Id == created.Id);

            var renamed = $"{marker}-renamed";
            await session.Client.UpdateDeviceAsync(
                session.Token,
                created.Id,
                created.Version,
                [FieldChange.Of("name", created.Name, renamed)],
                TestContext.Current.CancellationToken);
            await WaitUntilAsync(
                () => equipment.Rows.Any(row => row.Device.Name == renamed),
                "the device:updated delta should append the renamed device",
                TimeSpan.FromSeconds(20));

            // One submitted sample returns on the next scheduled push (default 30s
            // cadence + margin, like the contract suite's PushCycleWindow).
            using var clients = new ClientsViewModel(session, realtime, NullLogger.Instance);
            await clients.Initialization;
            await realtime.SubmitMetricsAsync(
                new MetricsSubmission(842.5, 91.25, 7, null), TestContext.Current.CancellationToken);
            await WaitUntilAsync(
                () => clients.LiveMetrics is { BandwidthDown: 842.5, BandwidthUp: 91.25, Latency: 7 },
                "the metrics:update push should return the submitted sample",
                TimeSpan.FromSeconds(75));
            Assert.True(clients.IsLive);
            Assert.Contains("842.5", clients.MetricsLine, StringComparison.Ordinal);
        }
        finally
        {
            await session.Client.DeleteDeviceAsync(session.Token, created.Id, CancellationToken.None);
        }

        // The delete echo removes the row the delta appended.
        await WaitUntilAsync(
            () => equipment.Rows.All(row => row.Device.Id != created.Id),
            "the device:deleted delta should remove the row",
            TimeSpan.FromSeconds(20));
    }

    private static async Task WaitUntilAsync(Func<bool> condition, string because, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (!condition())
        {
            Assert.True(DateTime.UtcNow < deadline, $"timed out waiting: {because}");
            await Task.Delay(200, TestContext.Current.CancellationToken);
        }
    }
}
