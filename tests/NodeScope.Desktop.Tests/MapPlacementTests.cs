using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// The map's placement flow (the web map's FAB → tap → form → auto-fly path) and the
/// selected-device edit/delete that the web kept in its detail panel.
/// </summary>
public sealed class MapPlacementTests : IDisposable
{
    private static readonly Uri Server = new("https://appliance.local/");

    private readonly FakeApplianceClient _client = new(Server);
    private readonly FakeRealtimeConnection _realtime = new();
    private MapViewModel? _viewModel;

    public MapPlacementTests()
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

    private async Task<MapViewModel> CreateAsync()
    {
        _viewModel = new MapViewModel(
            new ApplianceSession(_client, "token-1"),
            new CurrentUser("user-1", "owner@acme.test", "Owner"),
            NullLogger<MapViewModel>.Instance,
            _realtime,
            new ImmediateTimeProvider());
        await _viewModel.Initialization;
        return _viewModel;
    }

    [Fact]
    public async Task An_owner_with_a_network_gets_the_placement_button()
    {
        var viewModel = await CreateAsync();
        Assert.True(viewModel.CanConfigure);
    }

    [Fact]
    public async Task A_member_or_a_networkless_org_does_not()
    {
        _client.AccessToReturn = new AccessSummary("MEMBER", [], false);
        var member = await CreateAsync();
        Assert.False(member.CanConfigure);
        member.Dispose();

        _client.AccessToReturn = new AccessSummary("OWNER", [], true);
        _client.Networks.Clear();
        var networkless = await CreateAsync();
        Assert.False(networkless.CanConfigure);
    }

    [Fact]
    public async Task Placing_captures_the_tap_and_creating_adds_the_marker_and_selects_it()
    {
        var viewModel = await CreateAsync();

        viewModel.StartPlacementCommand.Execute(null);
        Assert.True(viewModel.IsPlacing);

        viewModel.CompletePlacement(40.71, -74.01);
        Assert.False(viewModel.IsPlacing);
        var form = viewModel.DeviceForm!;
        Assert.Equal(40.71, form.PlacedLatitude);

        form.Name = "Placed Router";
        form.SelectedProperty = form.Properties.Single(option => option.Id == "bldg-1");
        await form.SubmitCommand.ExecuteAsync(null);

        var created = Assert.Single(_client.CreatedDevices);
        Assert.Equal(40.71, created.Latitude);
        Assert.Equal("bldg-1", created.PropertyId);
        Assert.Null(viewModel.DeviceForm);
        Assert.Equal("Placed Router", viewModel.SelectedDevice!.Name);
        // Auto-fly reaches at least the category's reveal zoom (ROUTER = 13).
        Assert.True(viewModel.CurrentZoom >= 13);
    }

    [Fact]
    public async Task Cancelling_a_relocation_reopens_the_form_unchanged()
    {
        _client.BimDevices.Add(new BimDevice(
            "d1", "n1", "bldg-1", null, null, "Core Router", "ROUTER", 40.7, -74.0, null, null,
            null, null, null, null, null, null, null, 1, DateTime.UtcNow, DateTime.UtcNow));
        _client.Devices.Add(new MapDevice("d1", "Core Router", "ROUTER", 40.7, -74.0, null, null, null, "bldg-1"));
        var viewModel = await CreateAsync();
        viewModel.SelectDeviceById("d1");
        Assert.True(viewModel.SelectedDeviceEditable);

        await viewModel.EditSelectedCommand.ExecuteAsync(null);
        var form = viewModel.DeviceForm!;
        Assert.True(form.CanRelocate);

        form.RequestRelocateCommand.Execute(null);
        Assert.Null(viewModel.DeviceForm);
        Assert.True(viewModel.IsPlacing);

        viewModel.CancelPlacementCommand.Execute(null);
        Assert.False(viewModel.IsPlacing);
        Assert.Same(form, viewModel.DeviceForm);
        Assert.Null(form.PlacedLatitude);
    }

    [Fact]
    public async Task A_derived_pin_hides_relocation_and_says_where_it_comes_from()
    {
        // Placed in a georeferenced model: the pin is a projection of x/y/z, so the map
        // must not offer to move it - the 3D viewer owns that position.
        _client.BimDevices.Add(new BimDevice(
            "d1", "n1", "bldg-1", null, null, "Core Router", "ROUTER", 49.1, 8.44, null, null,
            1.0, 2.0, 0.5, null, null, null, null, 1, DateTime.UtcNow, DateTime.UtcNow));
        _client.Devices.Add(new MapDevice("d1", "Core Router", "ROUTER", 49.1, 8.44, null, null, null, "bldg-1"));
        _client.BuildingModels["bldg-1"] = new BuildingModelSummary(
            "m1", "bldg-1", "Main Building", "v1",
            new ModelGeoreferenceSummary(49.1, 8.44, 0, 0, 0, 1), 1);
        var viewModel = await CreateAsync();
        viewModel.SelectDeviceById("d1");

        await viewModel.EditSelectedCommand.ExecuteAsync(null);

        var form = viewModel.DeviceForm!;
        Assert.True(form.LocationDerived);
        Assert.False(form.CanRelocate);
        Assert.Contains("3D", form.CoordinateLine, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_placed_device_without_a_georeference_still_relocates_from_the_map()
    {
        _client.BimDevices.Add(new BimDevice(
            "d1", "n1", "bldg-1", null, null, "Core Router", "ROUTER", 40.7, -74.0, null, null,
            1.0, 2.0, 0.5, null, null, null, null, 1, DateTime.UtcNow, DateTime.UtcNow));
        _client.Devices.Add(new MapDevice("d1", "Core Router", "ROUTER", 40.7, -74.0, null, null, null, "bldg-1"));
        _client.BuildingModels["bldg-1"] = new BuildingModelSummary(
            "m1", "bldg-1", "Main Building", "v1", null, 1);
        var viewModel = await CreateAsync();
        viewModel.SelectDeviceById("d1");

        await viewModel.EditSelectedCommand.ExecuteAsync(null);

        var form = viewModel.DeviceForm!;
        Assert.False(form.LocationDerived);
        Assert.True(form.CanRelocate);
    }

    [Fact]
    public async Task A_relocation_tap_feeds_the_form_and_the_edit_moves_the_marker()
    {
        _client.BimDevices.Add(new BimDevice(
            "d1", "n1", "bldg-1", null, null, "Core Router", "ROUTER", 40.7, -74.0, null, null,
            null, null, null, null, null, null, null, 1, DateTime.UtcNow, DateTime.UtcNow));
        _client.Devices.Add(new MapDevice("d1", "Core Router", "ROUTER", 40.7, -74.0, null, null, null, "bldg-1"));
        var viewModel = await CreateAsync();
        viewModel.SelectDeviceById("d1");
        await viewModel.EditSelectedCommand.ExecuteAsync(null);
        var form = viewModel.DeviceForm!;

        form.RequestRelocateCommand.Execute(null);
        viewModel.CompletePlacement(41.0, -73.5);
        Assert.Same(form, viewModel.DeviceForm);
        Assert.Equal(41.0, form.PlacedLatitude);

        await form.SubmitCommand.ExecuteAsync(null);

        var (deviceId, _, changes) = Assert.Single(_client.DeviceUpdates);
        Assert.Equal("d1", deviceId);
        Assert.Contains(changes, change => change.Field == "latitude");
        Assert.Contains(changes, change => change.Field == "longitude");
    }

    [Fact]
    public async Task Selected_delete_is_two_step_and_rolls_back_on_failure()
    {
        _client.Devices.Add(new MapDevice("d1", "Core Router", "ROUTER", 40.7, -74.0, null, null, null, "bldg-1"));
        var viewModel = await CreateAsync();
        viewModel.SelectDeviceById("d1");

        await viewModel.DeleteSelectedCommand.ExecuteAsync(null);
        Assert.True(viewModel.ConfirmingSelectedDelete);
        Assert.NotNull(viewModel.SelectedDevice);

        _client.MutationFailure = new HttpRequestException("boom");
        await viewModel.DeleteSelectedCommand.ExecuteAsync(null);
        Assert.Null(viewModel.SelectedDevice);
        Assert.NotNull(viewModel.OperationError);

        // The rollback restored the marker cache: reselecting works.
        viewModel.SelectDeviceById("d1");
        Assert.NotNull(viewModel.SelectedDevice);
    }

    [Fact]
    public async Task An_out_of_scope_admin_cannot_edit_the_selected_device()
    {
        _client.AccessToReturn = new AccessSummary("ADMIN", ["site-other"], false);
        _client.Devices.Add(new MapDevice("d1", "Core Router", "ROUTER", 40.7, -74.0, null, null, null, "bldg-1"));
        var viewModel = await CreateAsync();

        viewModel.SelectDeviceById("d1");

        Assert.False(viewModel.SelectedDeviceEditable);
    }
}
