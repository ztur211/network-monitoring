using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Realtime;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// The circuits tab: cursor paging ("Load more" appends), totals, the device-linkage
/// picker, and the same mutation semantics as equipment.
/// </summary>
public sealed class CircuitsViewModelTests : IDisposable
{
    private static readonly Uri Server = new("https://appliance.local/");

    private readonly FakeApplianceClient _client = new(Server);
    private readonly FakeRealtimeConnection _realtime = new();
    private CircuitsViewModel? _viewModel;

    public void Dispose()
    {
        _viewModel?.Dispose();
        _client.Dispose();
        _realtime.Dispose();
    }

    private async Task<CircuitsViewModel> CreateAsync()
    {
        _viewModel = new CircuitsViewModel(
            new ApplianceSession(_client, "token-1"), _realtime, NullLogger.Instance);
        await _viewModel.Initialization;
        return _viewModel;
    }

    private Circuit AddCircuit(string id, string isp = "Comcast", double? bandwidth = null, string? deviceId = null)
    {
        var circuit = new Circuit(
            id, "user-1", isp, null, "Fiber", bandwidth, deviceId, null, 1, DateTime.UtcNow, DateTime.UtcNow);
        _client.Circuits.Add(circuit);
        return circuit;
    }

    [Fact]
    public async Task Load_more_appends_the_next_page_until_the_cursor_runs_out()
    {
        for (var i = 0; i < 60; i++)
        {
            AddCircuit($"c{i}");
        }

        var viewModel = await CreateAsync();

        Assert.Equal(50, viewModel.Rows.Count);
        Assert.Equal(60, viewModel.Total);
        Assert.True(viewModel.HasMore);

        await viewModel.LoadMoreCommand.ExecuteAsync(null);

        Assert.Equal(60, viewModel.Rows.Count);
        Assert.False(viewModel.HasMore);
        Assert.Equal([null, "50"], _client.CircuitCursorRequests);
    }

    [Fact]
    public async Task Bandwidth_formats_gbps_at_and_above_1000()
    {
        AddCircuit("c1", bandwidth: 1500);
        AddCircuit("c2", bandwidth: 300);

        var viewModel = await CreateAsync();

        Assert.Equal("1.5 Gbps", viewModel.Rows[0].BandwidthLabel);
        Assert.Equal("300 Mbps", viewModel.Rows[1].BandwidthLabel);
    }

    [Fact]
    public async Task Create_offers_the_fleet_as_linkage_options_and_prepends_the_row()
    {
        _client.BimDevices.Add(new BimDevice(
            "d1", "n1", "p1", null, null, "Core Router", "ROUTER", null, null, null, null,
            null, null, null, null, null, null, null, 1, DateTime.UtcNow, DateTime.UtcNow));
        var viewModel = await CreateAsync();

        await viewModel.BeginAddCommand.ExecuteAsync(null);
        var form = viewModel.Form!;
        Assert.Equal(2, form.Devices.Count); // "None" + the fleet
        Assert.Null(form.Devices[0].Id);

        form.IspName = "Verizon";
        form.ServiceType = "Fiber";
        form.Bandwidth = "1000";
        form.SelectedDevice = form.Devices[1];
        await form.SubmitCommand.ExecuteAsync(null);

        var created = Assert.Single(_client.CreatedCircuits);
        Assert.Equal("Verizon", created.IspName);
        Assert.Equal(1000, created.Bandwidth);
        Assert.Equal("d1", created.DeviceId);
        Assert.Equal("Verizon", viewModel.Rows[0].Circuit.IspName);
        Assert.Equal(1, viewModel.Total);
    }

    [Fact]
    public async Task Edit_diffs_including_a_cleared_device_link()
    {
        AddCircuit("c1", deviceId: "d1");
        var viewModel = await CreateAsync();

        await viewModel.BeginEditCommand.ExecuteAsync(viewModel.Rows[0]);
        var form = viewModel.Form!;
        form.SelectedDevice = form.Devices[0]; // "None" clears the link
        form.Bandwidth = "250";
        await form.SubmitCommand.ExecuteAsync(null);

        var (_, _, changes) = Assert.Single(_client.CircuitUpdates);
        Assert.Equal(2, changes.Count);
        Assert.Contains(changes, change => change.Field == "deviceId");
        Assert.Contains(changes, change => change.Field == "bandwidth");
        Assert.Null(Assert.Single(viewModel.Rows).Circuit.DeviceId);
    }

    [Fact]
    public async Task Delete_is_optimistic_and_restores_the_row_and_total_on_failure()
    {
        AddCircuit("c1");
        var viewModel = await CreateAsync();
        var row = viewModel.Rows[0];
        _client.MutationFailure = new HttpRequestException("boom");

        await viewModel.DeleteCommand.ExecuteAsync(row);
        await viewModel.DeleteCommand.ExecuteAsync(row);

        Assert.Single(viewModel.Rows);
        Assert.Equal(1, viewModel.Total);
        Assert.NotNull(viewModel.OperationError);
    }

    [Fact]
    public async Task Validation_blocks_a_submit_with_missing_required_fields()
    {
        var viewModel = await CreateAsync();
        await viewModel.BeginAddCommand.ExecuteAsync(null);
        var form = viewModel.Form!;

        await form.SubmitCommand.ExecuteAsync(null);

        Assert.NotEmpty(form.ValidationErrors);
        Assert.Empty(_client.CreatedCircuits);
        Assert.NotNull(viewModel.Form);
    }

    // --- realtime deltas ---------------------------------------------------

    [Fact]
    public async Task A_pushed_circuit_update_replaces_a_loaded_row_in_place()
    {
        var original = AddCircuit("c1", bandwidth: 300);
        var viewModel = await CreateAsync();

        _realtime.RaiseCircuitUpdated(new CircuitUpdatedEvent(
            original with { Bandwidth = 1500, Version = 2 }));

        Assert.Equal("1.5 Gbps", Assert.Single(viewModel.Rows).BandwidthLabel);
    }

    [Fact]
    public async Task A_pushed_update_for_an_unloaded_circuit_is_ignored()
    {
        // 60 circuits, page size 50: c59 exists server-side but is not loaded. Creates
        // never emit on this host, so an unseen id is always an unloaded page's row -
        // appending it (the web behavior) would corrupt server page order and Total.
        for (var i = 0; i < 60; i++)
        {
            AddCircuit($"c{i}");
        }

        var viewModel = await CreateAsync();
        var unloaded = _client.Circuits[59];

        _realtime.RaiseCircuitUpdated(new CircuitUpdatedEvent(unloaded with { Bandwidth = 999 }));

        Assert.Equal(50, viewModel.Rows.Count);
        Assert.Equal(60, viewModel.Total);
    }

    [Fact]
    public async Task A_pushed_delete_removes_the_loaded_row_and_keeps_total_honest()
    {
        AddCircuit("c1");
        AddCircuit("c2");
        var viewModel = await CreateAsync();

        _realtime.RaiseCircuitDeleted(new CircuitDeletedEvent("c1"));

        Assert.Single(viewModel.Rows);
        Assert.Equal(1, viewModel.Total);

        // The echo of a delete we never had - our own optimistic delete, or an
        // unloaded page's row - must not double-adjust the counter.
        _realtime.RaiseCircuitDeleted(new CircuitDeletedEvent("ghost"));
        Assert.Equal(1, viewModel.Total);
    }

    [Fact]
    public async Task A_reconnect_refetches_from_the_first_page()
    {
        AddCircuit("c1");
        var viewModel = await CreateAsync();

        AddCircuit("c2", isp: "Added While Disconnected");
        _realtime.RaiseReconnected();

        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(5);
        while (viewModel.Rows.Count != 2)
        {
            Assert.True(DateTime.UtcNow < deadline, "timed out waiting for the reconnect reload");
            await Task.Delay(10, TestContext.Current.CancellationToken);
        }

        Assert.Equal(2, viewModel.Total);
    }
}
