using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Realtime;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// The equipment tab against the fake appliance: load, the web-parity filters, the
/// F3 gating the web never had, and the create/edit/delete flows with their
/// failure semantics (await-then-apply for writes, optimistic delete with rollback).
/// </summary>
public sealed class EquipmentViewModelTests : IDisposable
{
    private static readonly Uri Server = new("https://appliance.local/");

    private readonly FakeApplianceClient _client = new(Server);
    private readonly FakeRealtimeConnection _realtime = new();
    private EquipmentViewModel? _viewModel;

    public EquipmentViewModelTests()
    {
        _client.Networks.Add(new NetworkSummary("n1", "Home", null, null, null, null, null, null, 1));
        _client.Properties.Add(new PropertySummary("site-1", null, "SITE", "HQ Campus", null));
        _client.Properties.Add(new PropertySummary("bldg-1", "site-1", "BUILDING", "Main Building", null));
    }

    public void Dispose()
    {
        _viewModel?.Dispose();
        _client.Dispose();
        _realtime.Dispose();
    }

    private async Task<EquipmentViewModel> CreateAsync()
    {
        _viewModel = new EquipmentViewModel(
            new ApplianceSession(_client, "token-1"), _realtime, NullLogger.Instance);
        await _viewModel.Initialization;
        return _viewModel;
    }

    private BimDevice AddDevice(
        string id, string name, string category = "ROUTER", int? floor = null, string propertyId = "bldg-1")
    {
        var device = new BimDevice(
            id, "n1", propertyId, null, "user-1", name, category, null, null, floor, null,
            null, null, null, null, null, null, null, 1, DateTime.UtcNow, DateTime.UtcNow);
        _client.BimDevices.Add(device);
        return device;
    }

    [Fact]
    public async Task Load_populates_rows_and_enables_add_for_an_owner()
    {
        AddDevice("d1", "Core Router");
        AddDevice("d2", "Lobby AP", "ACCESS_POINT");

        var viewModel = await CreateAsync();

        Assert.Equal(2, viewModel.Rows.Count);
        Assert.True(viewModel.CanAdd);
        Assert.False(viewModel.IsLoading);
        Assert.All(viewModel.Rows, row => Assert.True(row.CanConfigure));
    }

    [Fact]
    public async Task A_member_gets_a_read_only_list()
    {
        _client.AccessToReturn = new AccessSummary("MEMBER", [], false);
        AddDevice("d1", "Core Router");

        var viewModel = await CreateAsync();

        Assert.False(viewModel.CanAdd);
        Assert.False(Assert.Single(viewModel.Rows).CanConfigure);
    }

    [Fact]
    public async Task Troubleshoot_is_available_for_a_read_only_visible_device()
    {
        _client.AccessToReturn = new AccessSummary("MEMBER", [], false);
        var device = AddDevice("d1", "Core Router");
        BimDevice? requested = null;
        using var viewModel = new EquipmentViewModel(
            new ApplianceSession(_client, "token-1"),
            _realtime,
            NullLogger.Instance,
            troubleshoot: selected =>
            {
                requested = selected;
                return Task.CompletedTask;
            });
        await viewModel.Initialization;

        await viewModel.TroubleshootCommand.ExecuteAsync(Assert.Single(viewModel.Rows));

        Assert.Same(device, requested);
    }

    [Fact]
    public async Task A_scoped_admin_configures_only_inside_the_assigned_subtree()
    {
        _client.AccessToReturn = new AccessSummary("ADMIN", ["site-1"], false);
        _client.Properties.Add(new PropertySummary("site-2", null, "SITE", "Other Campus", null));
        AddDevice("in", "In scope", propertyId: "bldg-1");
        AddDevice("out", "Out of scope", propertyId: "site-2");

        var viewModel = await CreateAsync();

        Assert.True(viewModel.Rows.Single(row => row.Device.Id == "in").CanConfigure);
        Assert.False(viewModel.Rows.Single(row => row.Device.Id == "out").CanConfigure);
    }

    [Fact]
    public async Task Search_and_category_and_floor_filters_compose_like_the_web()
    {
        AddDevice("d1", "Core Router", "ROUTER", floor: 1);
        AddDevice("d2", "Core Switch", "SWITCH", floor: 1);
        AddDevice("d3", "Lobby AP", "ACCESS_POINT", floor: 0);

        var viewModel = await CreateAsync();

        viewModel.SearchText = "core";
        Assert.Equal(2, viewModel.Rows.Count);

        // The "Network" group chip narrows to SWITCH-family categories.
        viewModel.ToggleCategoryChipCommand.Execute(
            viewModel.CategoryChips.Single(chip => chip.Label == "Network"));
        Assert.Equal("d2", Assert.Single(viewModel.Rows).Device.Id);

        // The "All" chip clears the category filter.
        viewModel.ToggleCategoryChipCommand.Execute(
            viewModel.CategoryChips.Single(chip => chip.Label == "All"));
        viewModel.SearchText = "";
        Assert.Equal(3, viewModel.Rows.Count);

        var floorChip = viewModel.FloorChips.Single(chip => chip.Floor == 0);
        viewModel.SelectFloorChipCommand.Execute(floorChip);
        Assert.Equal("d3", Assert.Single(viewModel.Rows).Device.Id);

        // Re-selecting the active floor chip clears the floor filter (web parity).
        viewModel.SelectFloorChipCommand.Execute(
            viewModel.FloorChips.Single(chip => chip.Floor == 0));
        Assert.Equal(3, viewModel.Rows.Count);
    }

    [Fact]
    public async Task Create_submits_the_resolved_network_and_property_and_prepends_the_row()
    {
        var viewModel = await CreateAsync();
        viewModel.BeginAddCommand.Execute(null);
        var form = viewModel.Form!;

        form.Name = "New Switch";
        form.SelectedCategory = form.Categories.Single(category => category.Category == "SWITCH");
        form.SelectedProperty = form.Properties.Single(option => option.Id == "bldg-1");
        await form.SubmitCommand.ExecuteAsync(null);

        var created = Assert.Single(_client.CreatedDevices);
        Assert.Equal("n1", created.NetworkId);
        Assert.Equal("bldg-1", created.PropertyId);
        Assert.Equal("New Switch", created.Name);
        Assert.Null(viewModel.Form);
        Assert.Equal("New Switch", viewModel.Rows[0].Device.Name);
    }

    [Fact]
    public async Task Create_failure_keeps_the_form_open_with_the_server_error()
    {
        var viewModel = await CreateAsync();
        viewModel.BeginAddCommand.Execute(null);
        var form = viewModel.Form!;
        form.Name = "New Switch";
        form.SelectedProperty = form.Properties[0];
        _client.MutationFailure = new ApplianceApiException(
            "PROP_007", "Property is not chartered to the network", 422);

        await form.SubmitCommand.ExecuteAsync(null);

        Assert.NotNull(viewModel.Form);
        Assert.Contains("chartered", form.SubmitError, StringComparison.Ordinal);
        Assert.Empty(viewModel.Rows);
    }

    [Fact]
    public async Task Edit_sends_only_the_changed_fields_and_applies_the_server_row()
    {
        AddDevice("d1", "Core Router", floor: 1);
        var viewModel = await CreateAsync();
        viewModel.BeginEditCommand.Execute(viewModel.Rows[0]);
        var form = viewModel.Form!;

        form.Name = "Renamed Router";
        form.IpAddress = "10.0.0.9";
        await form.SubmitCommand.ExecuteAsync(null);

        var (deviceId, baseVersion, changes) = Assert.Single(_client.DeviceUpdates);
        Assert.Equal("d1", deviceId);
        Assert.Equal(1, baseVersion);
        Assert.Equal(2, changes.Count);
        Assert.Contains(changes, change => change.Field == "name");
        Assert.Contains(changes, change => change.Field == "ipAddress");
        Assert.Null(viewModel.Form);
        var row = Assert.Single(viewModel.Rows);
        Assert.Equal("Renamed Router", row.Device.Name);
        Assert.Equal(2, row.Device.Version);
    }

    [Fact]
    public async Task Edit_with_no_changes_closes_without_a_request()
    {
        AddDevice("d1", "Core Router");
        var viewModel = await CreateAsync();
        viewModel.BeginEditCommand.Execute(viewModel.Rows[0]);

        await viewModel.Form!.SubmitCommand.ExecuteAsync(null);

        Assert.Empty(_client.DeviceUpdates);
        Assert.Null(viewModel.Form);
    }

    [Fact]
    public async Task A_version_conflict_surfaces_and_refreshes_the_list()
    {
        var device = AddDevice("d1", "Core Router");
        var viewModel = await CreateAsync();
        viewModel.BeginEditCommand.Execute(viewModel.Rows[0]);
        var form = viewModel.Form!;

        // Another writer bumps the version while the form is open.
        _client.BimDevices[0] = device with { Name = "Renamed elsewhere", Version = 2 };
        form.Name = "My rename";
        await form.SubmitCommand.ExecuteAsync(null);

        Assert.NotNull(viewModel.Form);
        Assert.Contains("edited", form.SubmitError, StringComparison.Ordinal);
        Assert.Equal("Renamed elsewhere", Assert.Single(viewModel.Rows).Device.Name);
    }

    [Fact]
    public async Task Delete_is_two_step_optimistic_and_rolls_back_on_failure()
    {
        AddDevice("d1", "Core Router");
        var viewModel = await CreateAsync();
        var row = viewModel.Rows[0];

        // First press only arms the row.
        await viewModel.DeleteCommand.ExecuteAsync(row);
        Assert.True(row.ConfirmingDelete);
        Assert.Single(viewModel.Rows);
        Assert.Empty(_client.DeletedDeviceIds);

        await viewModel.DeleteCommand.ExecuteAsync(row);
        Assert.Empty(viewModel.Rows);
        Assert.Equal("d1", Assert.Single(_client.DeletedDeviceIds));

        // Rollback: the next delete fails server-side and the row returns.
        AddDevice("d2", "Lobby AP");
        await viewModel.LoadCommand.ExecuteAsync(null);
        var second = Assert.Single(viewModel.Rows);
        _client.MutationFailure = new HttpRequestException("boom");
        await viewModel.DeleteCommand.ExecuteAsync(second);
        await viewModel.DeleteCommand.ExecuteAsync(second);
        Assert.Single(viewModel.Rows);
        Assert.NotNull(viewModel.OperationError);
    }

    [Fact]
    public async Task Load_failure_surfaces_with_retry()
    {
        _client.InventoryFailure = new HttpRequestException("offline");

        var viewModel = await CreateAsync();

        Assert.NotNull(viewModel.LoadError);
        Assert.Empty(viewModel.Rows);

        _client.InventoryFailure = null;
        AddDevice("d1", "Core Router");
        await viewModel.LoadCommand.ExecuteAsync(null);
        Assert.Null(viewModel.LoadError);
        Assert.Single(viewModel.Rows);
    }

    // --- realtime deltas (web parity: pushed entity wins, no debounce) -----

    [Fact]
    public async Task A_pushed_device_update_replaces_the_row_in_place()
    {
        var original = AddDevice("d1", "Core Router");
        var viewModel = await CreateAsync();

        _realtime.RaiseDeviceUpdated(new DeviceUpdatedEvent(
            original with { Name = "Renamed Router", Version = 2 }));

        var row = Assert.Single(viewModel.Rows);
        Assert.Equal("Renamed Router", row.Device.Name);
        Assert.Equal(2, row.Device.Version);
    }

    [Fact]
    public async Task A_pushed_update_for_an_unseen_device_appends_it()
    {
        AddDevice("d1", "Core Router");
        var viewModel = await CreateAsync();

        // Creates never emit on this host: an unseen id is a device added since our
        // load whose first edit or placement just happened.
        var late = new BimDevice(
            "d2", "n1", "bldg-1", null, "user-2", "Late Switch", "SWITCH", null, null, 1, null,
            null, null, null, null, null, null, null, 2, DateTime.UtcNow, DateTime.UtcNow);
        _realtime.RaiseDeviceUpdated(new DeviceUpdatedEvent(late));

        Assert.Equal(2, viewModel.Rows.Count);
        Assert.Contains(viewModel.Rows, row => row.Device.Name == "Late Switch");
        // The appended device's floor joins the filter chips like a loaded one.
        Assert.Contains(viewModel.FloorChips, chip => chip.Floor == 1);
    }

    [Fact]
    public async Task A_pushed_delete_removes_the_row_and_an_unknown_id_is_silent()
    {
        AddDevice("d1", "Core Router");
        var viewModel = await CreateAsync();

        _realtime.RaiseDeviceDeleted(new DeviceDeletedEvent("ghost"));
        Assert.Single(viewModel.Rows);

        _realtime.RaiseDeviceDeleted(new DeviceDeletedEvent("d1"));
        Assert.Empty(viewModel.Rows);
    }

    [Fact]
    public async Task A_reconnect_refetches_the_list()
    {
        AddDevice("d1", "Core Router");
        var viewModel = await CreateAsync();
        Assert.Single(viewModel.Rows);

        // Deltas lost during the gap are unrecoverable - the reconnect reload is the
        // deliberate deviation that makes the list consistent again.
        AddDevice("d2", "Added While Disconnected");
        _realtime.RaiseReconnected();
        await WaitForRowsAsync(viewModel, 2);
    }

    private static async Task WaitForRowsAsync(EquipmentViewModel viewModel, int expected)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(5);
        while (viewModel.Rows.Count != expected)
        {
            Assert.True(DateTime.UtcNow < deadline, $"timed out waiting for {expected} rows");
            await Task.Delay(10, TestContext.Current.CancellationToken);
        }
    }
}
