using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Realtime;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// The assistant chat as a web-parity state machine: sends ride the realtime wire and
/// stream back as tokens then a completion; usage gates the input; failures land as a
/// retryable error instead of a stuck spinner.
/// </summary>
public sealed class AssistantViewModelTests : IDisposable
{
    private static readonly Uri Server = new("https://appliance.local/");

    private readonly FakeApplianceClient _client = new(Server);
    private readonly FakeRealtimeConnection _realtime = new();
    private AssistantViewModel? _viewModel;

    public void Dispose()
    {
        _viewModel?.Dispose();
        _client.Dispose();
        _realtime.Dispose();
    }

    private async Task<AssistantViewModel> CreateAsync()
    {
        _viewModel = new AssistantViewModel(
            new ApplianceSession(_client, "token-1"), _realtime, NullLogger.Instance);
        await _viewModel.Initialization;
        return _viewModel;
    }

    private static AiCompleteEvent Complete(
        string content,
        string conversationId = "conv-1",
        string providerStatus = "ok",
        string? usageWarning = null) =>
        new(content, conversationId, 12, 99_988, usageWarning, providerStatus, "2026-07-25T12:00:00.000Z");

    [Fact]
    public async Task Opening_loads_the_usage_counters()
    {
        var viewModel = await CreateAsync();

        Assert.Equal(1, _client.UsageReads);
        Assert.Equal("token-1", _client.LastBearerToken);
        Assert.Equal("0/20 messages this hour", viewModel.UsageSummary);
        Assert.Null(viewModel.BannerText);
    }

    [Fact]
    public async Task A_failed_usage_read_leaves_the_chat_usable()
    {
        _client.AssistantFailure = new HttpRequestException("down");
        var viewModel = await CreateAsync();

        Assert.Null(viewModel.Usage);
        Assert.Null(viewModel.UsageSummary);
        Assert.False(viewModel.IsLimitReached);
        Assert.True(viewModel.CanType);
    }

    [Fact]
    public async Task Sending_echoes_the_message_and_opens_a_streaming_answer()
    {
        var viewModel = await CreateAsync();
        viewModel.Input = "  Is my network healthy?  ";

        await viewModel.SendCommand.ExecuteAsync(null);

        var (content, conversationId) = Assert.Single(_realtime.SentMessages);
        Assert.Equal("Is my network healthy?", content);
        Assert.Null(conversationId);
        Assert.Equal("", viewModel.Input);
        Assert.True(viewModel.IsStreaming);
        Assert.Equal(2, viewModel.Transcript.Count);
        Assert.Equal("Is my network healthy?", Assert.IsType<UserChatEntry>(viewModel.Transcript[0]).Content);
        Assert.True(Assert.IsType<AssistantChatEntry>(viewModel.Transcript[1]).IsStreaming);
    }

    [Fact]
    public async Task Tokens_grow_the_streaming_answer_and_the_completion_finalizes_it()
    {
        var viewModel = await CreateAsync();
        viewModel.Input = "hello";
        await viewModel.SendCommand.ExecuteAsync(null);

        _realtime.RaiseToken(new AiTokenEvent("Every", "conv-1"));
        _realtime.RaiseToken(new AiTokenEvent("thing is fine.", "conv-1"));
        var entry = Assert.IsType<AssistantChatEntry>(viewModel.Transcript[1]);
        Assert.Equal("Everything is fine.", entry.Content);

        _realtime.RaiseComplete(Complete("Everything is fine.", usageWarning: "80% of budget used"));
        Assert.False(entry.IsStreaming);
        Assert.Equal("Everything is fine.", entry.Content);
        Assert.Equal("80% of budget used", entry.UsageWarning);
        Assert.False(entry.ProviderUnavailable);
        Assert.False(viewModel.IsStreaming);
        Assert.True(viewModel.ProviderAvailable);

        // The follow-up rides the conversation the completion named.
        viewModel.Input = "and the switches?";
        await viewModel.SendCommand.ExecuteAsync(null);
        Assert.Equal("conv-1", _realtime.SentMessages[1].ConversationId);
    }

    [Fact]
    public async Task An_unavailable_completion_flags_the_answer_and_raises_the_banner()
    {
        var viewModel = await CreateAsync();
        viewModel.Input = "hello";
        await viewModel.SendCommand.ExecuteAsync(null);

        _realtime.RaiseComplete(Complete("Fallback summary.", providerStatus: "unavailable"));

        var entry = Assert.IsType<AssistantChatEntry>(viewModel.Transcript[1]);
        Assert.True(entry.ProviderUnavailable);
        Assert.False(viewModel.ProviderAvailable);
        Assert.Contains("AI service temporarily unavailable", viewModel.BannerText, StringComparison.Ordinal);
        Assert.False(viewModel.BannerIsAlert);
        Assert.False(viewModel.BannerIsCaution);
    }

    [Fact]
    public async Task A_token_with_no_streaming_answer_has_nowhere_to_land()
    {
        var viewModel = await CreateAsync();
        viewModel.Input = "hello";
        await viewModel.SendCommand.ExecuteAsync(null);
        _realtime.RaiseComplete(Complete("Done."));

        _realtime.RaiseToken(new AiTokenEvent("stray", "conv-other"));

        Assert.Equal("Done.", Assert.IsType<AssistantChatEntry>(viewModel.Transcript[1]).Content);
    }

    [Fact]
    public async Task A_failed_send_becomes_a_retryable_error_not_a_stuck_spinner()
    {
        var viewModel = await CreateAsync();
        _realtime.SendFailure = new InvalidOperationException("not connected");
        viewModel.Input = "hello";

        await viewModel.SendCommand.ExecuteAsync(null);

        Assert.False(viewModel.IsStreaming);
        Assert.NotNull(viewModel.Error);
        var user = Assert.IsType<UserChatEntry>(Assert.Single(viewModel.Transcript));

        _realtime.SendFailure = null;
        await viewModel.RetryCommand.ExecuteAsync(null);

        var (content, _) = Assert.Single(_realtime.SentMessages);
        Assert.Equal(user.Content, content);
        Assert.Null(viewModel.Error);
        Assert.True(viewModel.IsStreaming);
        Assert.Equal(2, viewModel.Transcript.Count);
    }

    [Fact]
    public async Task An_ai_error_event_maps_its_code_and_drops_the_empty_answer()
    {
        var viewModel = await CreateAsync();
        viewModel.Input = "hello";
        await viewModel.SendCommand.ExecuteAsync(null);

        _realtime.RaiseError(new RealtimeErrorEvent("AI_001", "limit", "ai"));

        Assert.Equal("Hourly message limit reached. Try again next hour.", viewModel.Error);
        Assert.False(viewModel.IsStreaming);
        Assert.Single(viewModel.Transcript); // the echoed user line stays, the empty bubble goes
    }

    [Fact]
    public async Task A_non_ai_error_event_is_someone_elses_problem()
    {
        var viewModel = await CreateAsync();
        viewModel.Input = "hello";
        await viewModel.SendCommand.ExecuteAsync(null);

        _realtime.RaiseError(new RealtimeErrorEvent("SYNC_001", "conflict", "devices"));

        Assert.Null(viewModel.Error);
        Assert.True(viewModel.IsStreaming);
    }

    [Fact]
    public async Task Clearing_forgets_the_conversation_on_the_server_and_locally()
    {
        var viewModel = await CreateAsync();
        viewModel.Input = "hello";
        await viewModel.SendCommand.ExecuteAsync(null);
        _realtime.RaiseComplete(Complete("Done."));

        await viewModel.ClearConversationCommand.ExecuteAsync(null);

        Assert.Equal("conv-1", Assert.Single(_client.DeletedConversations));
        Assert.Empty(viewModel.Transcript);
        Assert.False(viewModel.HasMessages);

        // A fresh conversation starts from scratch.
        viewModel.Input = "again";
        await viewModel.SendCommand.ExecuteAsync(null);
        Assert.Null(_realtime.SentMessages[^1].ConversationId);
    }

    [Fact]
    public async Task A_failed_server_delete_still_clears_the_view()
    {
        var viewModel = await CreateAsync();
        viewModel.Input = "hello";
        await viewModel.SendCommand.ExecuteAsync(null);
        _realtime.RaiseComplete(Complete("Done."));
        _client.AssistantFailure = new HttpRequestException("gone");

        await viewModel.ClearConversationCommand.ExecuteAsync(null);

        Assert.Empty(viewModel.Transcript);
    }

    [Fact]
    public async Task An_exhausted_hourly_limit_locks_the_input()
    {
        _client.UsageToReturn = _client.UsageToReturn with { HourlyUsed = 20 };
        var viewModel = await CreateAsync();

        Assert.True(viewModel.IsLimitReached);
        Assert.False(viewModel.CanType);
        Assert.False(viewModel.CanSend);
        Assert.Equal("Message limit reached", viewModel.InputPlaceholder);
        Assert.True(viewModel.BannerIsAlert);
        Assert.Contains("Hourly message limit reached (20/20)", viewModel.BannerText, StringComparison.Ordinal);

        viewModel.Input = "hello";
        await viewModel.SendCommand.ExecuteAsync(null);
        Assert.Empty(_realtime.SentMessages);
    }

    [Fact]
    public async Task Eighty_percent_of_a_limit_is_a_caution_not_a_lock()
    {
        _client.UsageToReturn = _client.UsageToReturn with { HourlyUsed = 16 };
        var viewModel = await CreateAsync();

        Assert.False(viewModel.IsLimitReached);
        Assert.True(viewModel.BannerIsCaution);
        Assert.False(viewModel.BannerIsAlert);
        Assert.Equal("16/20 messages used this hour", viewModel.BannerText);
        Assert.True(viewModel.CanType);
    }

    [Fact]
    public async Task A_starter_prompt_sends_as_is()
    {
        var viewModel = await CreateAsync();

        await viewModel.AskSuggestionCommand.ExecuteAsync(viewModel.Suggestions[0]);

        Assert.Equal(viewModel.Suggestions[0], Assert.Single(_realtime.SentMessages).Content);
        Assert.Equal(viewModel.Suggestions[0], Assert.IsType<UserChatEntry>(viewModel.Transcript[0]).Content);
    }

    [Fact]
    public async Task An_oversized_message_is_refused_loudly_instead_of_dropped_silently()
    {
        var viewModel = await CreateAsync();
        viewModel.Input = new string('a', 2001);

        await viewModel.SendCommand.ExecuteAsync(null);

        Assert.Empty(_realtime.SentMessages);
        Assert.Empty(viewModel.Transcript);
        Assert.Contains("2000", viewModel.Error, StringComparison.Ordinal);
    }
}
