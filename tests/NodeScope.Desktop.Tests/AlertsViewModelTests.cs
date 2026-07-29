using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Realtime;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using Xunit;

namespace NodeScope.Desktop.Tests;

public sealed class AlertsViewModelTests : IDisposable
{
    private static readonly Uri Server = new("https://appliance.local/");
    private static readonly DateTime Now = new(2026, 7, 29, 5, 0, 0, DateTimeKind.Utc);
    private readonly FakeApplianceClient _client = new(Server);
    private readonly FakeRealtimeConnection _realtime = new();
    private AlertsViewModel? _viewModel;

    public void Dispose()
    {
        _viewModel?.Dispose();
        _client.Dispose();
        _realtime.Dispose();
    }

    [Fact]
    public async Task Owner_loads_history_channels_and_rules()
    {
        Seed();
        var viewModel = await CreateAsync();

        Assert.True(viewModel.CanManage);
        Assert.Single(viewModel.Events);
        Assert.Single(viewModel.Channels);
        Assert.Single(viewModel.Rules);
    }

    [Fact]
    public async Task Member_is_gated_without_calling_admin_endpoints()
    {
        _client.AccessToReturn = new AccessSummary("MEMBER", [], false);
        _client.AlertFailure = new InvalidOperationException("must not be called");

        var viewModel = await CreateAsync();

        Assert.False(viewModel.CanManage);
        Assert.Null(viewModel.Error);
        Assert.Empty(viewModel.Events);
    }

    [Fact]
    public async Task Creating_webhook_never_round_trips_the_secret_into_a_row()
    {
        var viewModel = await CreateAsync();
        viewModel.ChannelName = "Operations";
        viewModel.WebhookUrl = "https://hooks.example.test/nodescope";
        viewModel.ChannelSecret = "write-only";

        await viewModel.CreateChannelCommand.ExecuteAsync(null);

        var request = Assert.Single(_client.CreatedAlertChannels);
        Assert.Equal("write-only", request.Secret);
        Assert.Equal("Operations", Assert.Single(viewModel.Channels).Channel.Name);
        Assert.DoesNotContain("write-only", viewModel.Channels[0].Channel.Config.GetRawText(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Creating_state_rule_uses_selected_channel_and_recovery()
    {
        SeedChannel();
        var viewModel = await CreateAsync();
        viewModel.Channels[0].Selected = true;
        viewModel.RuleName = "Device down";
        viewModel.RuleSeverity = "CRITICAL";
        viewModel.TargetDown = true;

        await viewModel.CreateRuleCommand.ExecuteAsync(null);

        var request = Assert.Single(_client.CreatedAlertRules);
        Assert.Equal(["DOWN"], request.TargetStates);
        Assert.Equal([_client.AlertChannels[0].Id], request.ChannelIds);
        Assert.True(request.NotifyOnRecovery);
        Assert.True(request.Scope.GetProperty("all").GetBoolean());
    }

    [Fact]
    public async Task Live_alerts_prepend_and_resolutions_remain_chronological()
    {
        var viewModel = await CreateAsync();
        var detail = Json("""{"state":"DOWN"}""");

        _realtime.RaiseAlertFired(new AlertRealtimeEvent(
            "event-1", "rule-1", "Device down", "device-1", "CRITICAL", detail, Now));
        _realtime.RaiseAlertResolved(new AlertRealtimeEvent(
            "event-2", "rule-1", "Device down", "device-1", "CRITICAL", detail, Now.AddMinutes(1)));

        Assert.Equal(["event-2", "event-1"], viewModel.Events.Select(row => row.Event.Id));
        Assert.Equal("RESOLVED", viewModel.Events[0].Event.Kind);
    }

    private async Task<AlertsViewModel> CreateAsync()
    {
        _viewModel = new AlertsViewModel(
            new ApplianceSession(_client, "token-1"),
            _realtime,
            NullLogger<AlertsViewModel>.Instance);
        await _viewModel.Initialization;
        return _viewModel;
    }

    private void Seed()
    {
        SeedChannel();
        _client.AlertRules.Add(Rule());
        _client.AlertEvents.Add(Event());
    }

    private void SeedChannel()
    {
        _client.AlertChannels.Add(new AlertChannel(
            Guid.NewGuid().ToString(),
            "org-1",
            "INAPP",
            "Desktop",
            true,
            Json("{}"),
            1,
            Now,
            Now));
    }

    private AlertRule Rule() => new(
        Guid.NewGuid().ToString(),
        "org-1",
        "Device down",
        true,
        "STATE_TRANSITION",
        Json("""{"all":true}"""),
        ["DOWN"],
        null,
        null,
        null,
        null,
        "CRITICAL",
        [_client.AlertChannels[0].Id],
        60,
        true,
        1,
        Now,
        Now);

    private static AlertEvent Event() => new(
        "event-1",
        "org-1",
        "rule-1",
        "Device down",
        "device-1",
        "FIRING",
        "CRITICAL",
        Json("""{"state":"DOWN"}"""),
        "rule-1:device-1",
        Now);

    private static JsonElement Json(string value)
    {
        using var document = JsonDocument.Parse(value);
        return document.RootElement.Clone();
    }
}
