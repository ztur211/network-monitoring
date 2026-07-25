using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// The wizard as a chat renderer: the init turn, chip picks, typed field submission
/// (numbers as numbers), required gating, skip, the client-side close chip, and the
/// silent ONBOARD_002 close.
/// </summary>
public sealed class OnboardingViewModelTests : IDisposable
{
    private static readonly Uri Server = new("https://appliance.local/");

    private readonly FakeApplianceClient _client = new(Server);
    private OnboardingViewModel? _viewModel;
    private bool _closed;

    public void Dispose()
    {
        _viewModel?.Dispose();
        _client.Dispose();
    }

    private async Task<OnboardingViewModel> CreateAsync()
    {
        _viewModel = new OnboardingViewModel(
            new ApplianceSession(_client, "token-1"),
            NullLogger.Instance,
            close: () => _closed = true);
        await _viewModel.Initialization;
        return _viewModel;
    }

    [Fact]
    public async Task Opening_sends_the_init_turn_and_renders_the_step()
    {
        var viewModel = await CreateAsync();

        var (chip, fields) = Assert.Single(_client.TurnRequests);
        Assert.Null(chip);
        Assert.Null(fields);
        Assert.Equal("Welcome!", Assert.IsType<BotEntry>(Assert.Single(viewModel.Transcript)).Message);
        Assert.Equal("start", Assert.Single(viewModel.Chips).Value);
    }

    [Fact]
    public async Task A_chip_pick_sends_the_choice_and_echoes_the_label()
    {
        _client.TurnsToReturn.Add(new OnboardingTurn(
            "welcome", "Welcome!", [new OnboardingChip("Let's go", "start")], [], false));
        _client.TurnsToReturn.Add(new OnboardingTurn(
            "networkName",
            "What should we call it?",
            [],
            [new OnboardingField("name", "text", "Network name", "Home", true)],
            false));
        var viewModel = await CreateAsync();

        await viewModel.PickChipCommand.ExecuteAsync(viewModel.Chips[0]);

        Assert.Equal("start", _client.TurnRequests[1].ChipChoice);
        Assert.Equal(3, viewModel.Transcript.Count);
        Assert.Equal("Let's go", Assert.IsType<UserEntry>(viewModel.Transcript[1]).Message);
        Assert.True(viewModel.HasFields);
    }

    [Fact]
    public async Task Field_submission_sends_numbers_as_numbers_and_gates_required()
    {
        _client.TurnsToReturn.Add(new OnboardingTurn(
            "speeds",
            "How fast is it?",
            [new OnboardingChip("Skip", "skip")],
            [
                new OnboardingField("downMbps", "number", "Download Mbps", null, null),
                new OnboardingField("name", "text", "Label", null, true),
            ],
            false));
        _client.TurnsToReturn.Add(new OnboardingTurn("done", "All set!", [new OnboardingChip("Close", "close")], [], true));
        var viewModel = await CreateAsync();

        // Required text field empty: blocked client-side, no request.
        viewModel.Fields.Single(field => field.Field.Key == "downMbps").Text = "500";
        await viewModel.SubmitFieldsCommand.ExecuteAsync(null);
        Assert.Contains("required", viewModel.Error, StringComparison.Ordinal);
        Assert.Single(_client.TurnRequests);

        // A non-numeric number field: also blocked.
        viewModel.Fields.Single(field => field.Field.Key == "name").Text = "Home";
        viewModel.Fields.Single(field => field.Field.Key == "downMbps").Text = "fast";
        await viewModel.SubmitFieldsCommand.ExecuteAsync(null);
        Assert.Contains("must be a number", viewModel.Error, StringComparison.Ordinal);

        viewModel.Fields.Single(field => field.Field.Key == "downMbps").Text = "500";
        await viewModel.SubmitFieldsCommand.ExecuteAsync(null);

        var values = _client.TurnRequests[^1].FieldValues!;
        Assert.Equal(500d, Assert.IsType<double>(values["downMbps"]));
        Assert.Equal("Home", values["name"]);
        Assert.True(viewModel.IsComplete);
    }

    [Fact]
    public async Task Skip_posts_the_dismissal_and_closes()
    {
        var viewModel = await CreateAsync();

        await viewModel.SkipCommand.ExecuteAsync(null);

        Assert.Equal(1, _client.SkipCalls);
        Assert.True(_closed);
    }

    [Fact]
    public async Task The_done_steps_close_chip_closes_without_a_request()
    {
        _client.TurnsToReturn.Add(new OnboardingTurn(
            "done", "All set!", [new OnboardingChip("Close", "close")], [], true));
        var viewModel = await CreateAsync();

        await viewModel.PickChipCommand.ExecuteAsync(viewModel.Chips[0]);

        Assert.True(_closed);
        Assert.Single(_client.TurnRequests); // only the init turn ever went out
        Assert.Equal(0, _client.SkipCalls);
    }

    [Fact]
    public async Task Already_complete_onboarding_closes_silently()
    {
        _client.OnboardingFailure = new ApplianceApiException("ONBOARD_002", "ALREADY_COMPLETE", 409);

        var viewModel = await CreateAsync();

        Assert.True(_closed);
        Assert.Null(viewModel.Error);
    }

    [Fact]
    public async Task A_transport_failure_surfaces_and_the_wizard_stays_open()
    {
        _client.OnboardingFailure = new HttpRequestException("offline");

        var viewModel = await CreateAsync();

        Assert.False(_closed);
        Assert.NotNull(viewModel.Error);
    }
}
