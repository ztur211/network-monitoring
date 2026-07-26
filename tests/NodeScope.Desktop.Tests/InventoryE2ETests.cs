using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Auth;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// The CRUD milestone live: the real client code signs in natively and
/// walks a device and a circuit through create → edit → delete against the real
/// appliance API, exactly as the inventory tabs drive it - including the property and
/// network resolution the retired web client never did.
/// </summary>
/// <remarks>
/// Env-gated: bring up the appliance stack with the demo seed and run with
/// <c>NODESCOPE_DESKTOP_INVENTORY_E2E_BASE_URL=http://localhost:8080</c>. Credentials
/// default to the demo owner; override with
/// <c>NODESCOPE_DESKTOP_INVENTORY_E2E_EMAIL</c>/<c>…_PASSWORD</c>.
/// </remarks>
[Collection(LiveApplianceSuite.Name)]
public sealed class InventoryE2ETests : IDisposable
{
    private readonly DirectoryInfo _scratch = Directory.CreateTempSubdirectory("nodescope-inventory-e2e-");

    public void Dispose() => _scratch.Delete(recursive: true);

    [Fact]
    public async Task Devices_and_circuits_walk_create_edit_delete_against_the_live_appliance()
    {
        if (OperatingSystem.IsWindows())
        {
            Assert.Skip("the E2E drives the Linux dev-loop vault; Windows runs use DPAPI");
            return;
        }

        var configured = Environment.GetEnvironmentVariable("NODESCOPE_DESKTOP_INVENTORY_E2E_BASE_URL");
        Assert.SkipWhen(string.IsNullOrEmpty(configured),
            "set NODESCOPE_DESKTOP_INVENTORY_E2E_BASE_URL (appliance stack + demo seed) to run");

        var server = new Uri(configured);
        var email = Environment.GetEnvironmentVariable("NODESCOPE_DESKTOP_INVENTORY_E2E_EMAIL") ?? "owner@acme.test";
        var password = Environment.GetEnvironmentVariable("NODESCOPE_DESKTOP_INVENTORY_E2E_PASSWORD") ?? "devpassword123";

        var vault = new PlainFileTokenVault(Path.Combine(_scratch.FullName, "vault.json"));
        var settings = new SettingsStore(Path.Combine(_scratch.FullName, "settings.json"));
        using var factory = new ApplianceClientFactory();
        using var flow = new DesktopAuthFlow(factory, vault, settings, NullLogger<DesktopAuthFlow>.Instance);

        await LiveSignIn.RestoreAsync(flow, vault, server, email, password);
        Assert.Equal(SessionPhase.SignedIn, flow.Current.Phase);
        var session = flow.Session!;

        using var equipmentRealtime = new FakeRealtimeConnection();
        using var equipment = new EquipmentViewModel(session, equipmentRealtime, NullLogger.Instance);
        await equipment.Initialization;
        Assert.Null(equipment.LoadError);
        Assert.True(equipment.CanAdd, "the demo owner should be able to add devices");
        Assert.NotEmpty(equipment.Rows);

        // Create on the property a seeded device already lives on - guaranteed chartered.
        var anchor = equipment.Rows[0].Device;
        var marker = $"E2E-{Guid.NewGuid():N}";
        string? createdDeviceId = null;
        string? createdCircuitId = null;
        try
        {
            equipment.BeginAddCommand.Execute(null);
            var form = equipment.Form!;
            form.Name = marker;
            form.SelectedCategory = form.Categories.Single(category => category.Category == "SWITCH");
            form.SelectedProperty = form.Properties.Single(option => option.Id == anchor.PropertyId);
            form.Floor = "2";
            form.IpAddress = "10.99.0.42";
            await form.SubmitCommand.ExecuteAsync(null);

            Assert.Null(equipment.Form);
            var created = equipment.Rows.Single(row => row.Device.Name == marker).Device;
            createdDeviceId = created.Id;
            Assert.Equal("SWITCH", created.Category);
            Assert.Equal(1, created.Version);

            // Edit: rename + clear the IP; the changeset must round-trip and bump the version.
            equipment.BeginEditCommand.Execute(equipment.Rows.Single(row => row.Device.Id == createdDeviceId));
            var edit = equipment.Form!;
            edit.Name = $"{marker}-renamed";
            edit.IpAddress = "";
            await edit.SubmitCommand.ExecuteAsync(null);

            Assert.Null(equipment.Form);
            var updated = equipment.Rows.Single(row => row.Device.Id == createdDeviceId).Device;
            Assert.Equal($"{marker}-renamed", updated.Name);
            Assert.Null(updated.IpAddress);
            Assert.Equal(2, updated.Version);

            // Circuit: create linked to the new device, then delete it.
            using var circuitsRealtime = new FakeRealtimeConnection();
            using var circuits = new CircuitsViewModel(session, circuitsRealtime, NullLogger.Instance);
            await circuits.Initialization;
            Assert.Null(circuits.LoadError);

            await circuits.BeginAddCommand.ExecuteAsync(null);
            var circuitForm = circuits.Form!;
            circuitForm.IspName = marker;
            circuitForm.ServiceType = "Fiber";
            circuitForm.Bandwidth = "500";
            circuitForm.SelectedDevice = circuitForm.Devices.Single(option => option.Id == createdDeviceId);
            await circuitForm.SubmitCommand.ExecuteAsync(null);

            Assert.Null(circuits.Form);
            var circuit = circuits.Rows.Single(row => row.Circuit.IspName == marker).Circuit;
            createdCircuitId = circuit.Id;
            Assert.Equal(createdDeviceId, circuit.DeviceId);
            Assert.Equal("500 Mbps", circuits.Rows.Single(row => row.Circuit.Id == circuit.Id).BandwidthLabel);

            var circuitRow = circuits.Rows.Single(row => row.Circuit.Id == circuit.Id);
            await circuits.DeleteCommand.ExecuteAsync(circuitRow);
            await circuits.DeleteCommand.ExecuteAsync(circuitRow);
            Assert.Null(circuits.OperationError);
            Assert.DoesNotContain(circuits.Rows, row => row.Circuit.Id == circuit.Id);
            createdCircuitId = null;

            // Device delete last (a linked circuit would otherwise hold a pointer).
            var deviceRow = equipment.Rows.Single(row => row.Device.Id == createdDeviceId);
            await equipment.DeleteCommand.ExecuteAsync(deviceRow);
            await equipment.DeleteCommand.ExecuteAsync(deviceRow);
            Assert.Null(equipment.OperationError);
            createdDeviceId = null;

            // The deletion is server-side truth, not client bookkeeping: reload and check.
            await equipment.LoadCommand.ExecuteAsync(null);
            Assert.DoesNotContain(equipment.Rows, row => row.Device.Name == $"{marker}-renamed");
        }
        finally
        {
            // Never leave E2E residue in the demo org, even on assertion failure.
            if (createdCircuitId is not null)
            {
                await session.Client.DeleteCircuitAsync(session.Token, createdCircuitId, CancellationToken.None);
            }

            if (createdDeviceId is not null)
            {
                await session.Client.DeleteDeviceAsync(session.Token, createdDeviceId, CancellationToken.None);
            }
        }
    }
}
