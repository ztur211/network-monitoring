using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.VisualTree;
using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using NodeScope.Desktop.Views;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// The inventory section on the headless platform: the tabs render their lists, the
/// add affordance follows the role, and the form overlays open bound to their rows.
/// </summary>
public sealed class InventoryViewTests : IDisposable
{
    private static readonly Uri Server = new("https://appliance.local/");

    private readonly FakeApplianceClient _client = new(Server);
    private readonly FakeRealtimeConnection _realtime = new();
    private InventoryViewModel? _viewModel;

    public InventoryViewTests()
    {
        _client.Networks.Add(new NetworkSummary("n1", "Home", null, null, null, null, null, null, 1));
        _client.Properties.Add(new PropertySummary("site-1", null, "SITE", "HQ Campus", null));
        _client.BimDevices.Add(new BimDevice(
            "d1", "n1", "site-1", null, null, "Core Router", "ROUTER", null, null, null, null,
            null, null, null, null, "10.0.0.1", null, null, 1, DateTime.UtcNow, DateTime.UtcNow));
        _client.Circuits.Add(new Circuit(
            "c1", null, "Comcast", "X-1", "Fiber", 1000, null, null, 1, DateTime.UtcNow, DateTime.UtcNow));
    }

    public void Dispose()
    {
        _viewModel?.Dispose();
        _client.Dispose();
        _realtime.Dispose();
    }

    private async Task<InventoryView> CreateShownViewAsync(int tab = 0)
    {
        _viewModel = new InventoryViewModel(
            new ApplianceSession(_client, "token-1"), _realtime, NullLoggerFactory.Instance);
        await Task.WhenAll(
            _viewModel.Equipment.Initialization,
            _viewModel.Circuits.Initialization,
            _viewModel.Clients.Initialization);
        var view = new InventoryView { DataContext = _viewModel };
        var window = new Window { Content = view };
        window.Show();

        // Only the selected tab's content is materialized - pick it, then re-layout.
        view.FindControl<TabControl>("InventoryTabs")!.SelectedIndex = tab;
        window.UpdateLayout();
        return view;
    }

    [AvaloniaFact]
    public async Task The_equipment_tab_lists_devices_with_the_add_button()
    {
        var view = await CreateShownViewAsync();

        var list = view.FindControl<ItemsControl>("DeviceList")!;
        Assert.Equal(1, list.ItemCount);
        Assert.True(view.FindControl<Button>("AddDeviceButton")!.IsVisible);
        Assert.False(view.FindControl<TextBlock>("EquipmentEmpty")!.IsVisible);
    }

    [AvaloniaFact]
    public async Task A_member_sees_no_add_button()
    {
        _client.AccessToReturn = new AccessSummary("MEMBER", [], false);

        var view = await CreateShownViewAsync();

        Assert.False(view.FindControl<Button>("AddDeviceButton")!.IsVisible);
    }

    [AvaloniaFact]
    public async Task The_empty_state_shows_when_the_org_has_no_devices()
    {
        _client.BimDevices.Clear();

        var view = await CreateShownViewAsync();

        Assert.True(view.FindControl<TextBlock>("EquipmentEmpty")!.IsVisible);
    }

    [AvaloniaFact]
    public async Task Opening_the_device_form_renders_the_modal_bound_to_the_fields()
    {
        var view = await CreateShownViewAsync();

        _viewModel!.Equipment.BeginAddCommand.Execute(null);
        view.UpdateLayout();
        // The overlay materializes the DeviceFormView through the DataTemplate.
        var form = view.GetVisualDescendants().OfType<DeviceFormView>().Single();
        Assert.True(form.FindControl<TextBox>("NameBox")!.IsVisible);
        Assert.NotNull(form.FindControl<ComboBox>("PropertyPicker"));
    }

    [AvaloniaFact]
    public async Task The_circuits_tab_shows_the_total_and_rows()
    {
        var view = await CreateShownViewAsync(tab: 1);

        Assert.Equal("1 circuit", view.FindControl<TextBlock>("CircuitsTotal")!.Text);
        Assert.Equal(1, view.FindControl<ItemsControl>("CircuitList")!.ItemCount);
        Assert.False(view.FindControl<Button>("LoadMoreButton")!.IsVisible);
    }

    [AvaloniaFact]
    public async Task The_clients_tab_shows_the_device_card_and_agent_notice()
    {
        var view = await CreateShownViewAsync(tab: 2);

        Assert.Equal("Linux", view.FindControl<TextBlock>("ClientPlatform")!.Text);
        Assert.Contains(
            "post-MVP",
            view.FindControl<TextBlock>("AgentStatusMessage")!.Text,
            StringComparison.OrdinalIgnoreCase);
    }

    [AvaloniaFact]
    public async Task A_metrics_push_lights_the_live_dot_and_fills_the_metrics_line()
    {
        var view = await CreateShownViewAsync(tab: 2);
        Assert.False(view.FindControl<Avalonia.Controls.Shapes.Ellipse>("ClientsLiveDot")!.IsVisible);

        _realtime.RaiseMetricsUpdate(new NodeScope.Desktop.Realtime.MetricsUpdateEvent(
            new ClientMetrics(250, 25, 12, null, DateTime.UtcNow), ["browser"]));
        view.UpdateLayout();

        Assert.True(view.FindControl<Avalonia.Controls.Shapes.Ellipse>("ClientsLiveDot")!.IsVisible);
        Assert.Contains("250", view.FindControl<TextBlock>("ClientMetrics")!.Text, StringComparison.Ordinal);
        Assert.True(view.FindControl<TextBlock>("ClientMetricsUpdated")!.IsVisible);
    }
}
