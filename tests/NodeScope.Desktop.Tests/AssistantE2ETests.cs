using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Auth;
using NodeScope.Desktop.Realtime;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// The assistant live, end to end: a real PKCE sign-in, a real SignalR connection to
/// <c>/hubs/v1</c>, a question over <c>v1:ai:message</c>, and the host's fallback answer
/// streaming back as a token then an unavailable completion (Decision 9: the appliance
/// has no provider, so the graceful-degradation path IS the production path today).
/// Clearing exercises the conversation delete's 404 tolerance - the C# host stores no
/// conversation, so the delete always misses.
/// </summary>
/// <remarks>
/// Env-gated like the other live E2Es:
/// <c>NODESCOPE_DESKTOP_ASSISTANT_E2E_BASE_URL=http://localhost:8080</c> against the
/// appliance stack + demo seed.
/// </remarks>
[Collection(LiveApplianceSuite.Name)]
public sealed class AssistantE2ETests : IDisposable
{
    private readonly DirectoryInfo _scratch = Directory.CreateTempSubdirectory("nodescope-assistant-e2e-");

    public void Dispose() => _scratch.Delete(recursive: true);

    [Fact]
    public async Task The_chat_streams_the_fallback_answer_over_the_live_wire()
    {
        if (OperatingSystem.IsWindows())
        {
            Assert.Skip("the E2E drives the Linux dev-loop vault; Windows runs use DPAPI");
            return;
        }

        var configured = Environment.GetEnvironmentVariable("NODESCOPE_DESKTOP_ASSISTANT_E2E_BASE_URL");
        Assert.SkipWhen(string.IsNullOrEmpty(configured),
            "set NODESCOPE_DESKTOP_ASSISTANT_E2E_BASE_URL (appliance stack + demo seed) to run");

        var server = new Uri(configured);
        var email = Environment.GetEnvironmentVariable("NODESCOPE_DESKTOP_ASSISTANT_E2E_EMAIL") ?? "owner@acme.test";
        var password = Environment.GetEnvironmentVariable("NODESCOPE_DESKTOP_ASSISTANT_E2E_PASSWORD") ?? "devpassword123";

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

        using var assistant = new AssistantViewModel(session, realtime, NullLogger.Instance);
        await assistant.Initialization;

        // The demo seed spends nothing: fresh counters against positive limits.
        Assert.NotNull(assistant.Usage);
        Assert.Equal(0, assistant.Usage!.HourlyUsed);
        Assert.True(assistant.Usage.HourlyLimit > 0);
        Assert.False(assistant.IsLimitReached);

        assistant.Input = "What does my network look like?";
        await assistant.SendCommand.ExecuteAsync(null);
        await WaitUntilAsync(() => !assistant.IsStreaming, "the completion should end the stream");

        Assert.Null(assistant.Error);
        Assert.Equal(2, assistant.Transcript.Count);
        var answer = Assert.IsType<AssistantChatEntry>(assistant.Transcript[1]);
        Assert.False(answer.IsStreaming);
        // The fallback streams as one token and the completion repeats it verbatim.
        Assert.Contains("temporarily unable", answer.Content, StringComparison.Ordinal);
        Assert.True(answer.ProviderUnavailable, "Decision 9: no provider, every answer is the fallback");
        Assert.False(assistant.ProviderAvailable);
        Assert.Contains("AI service temporarily unavailable", assistant.BannerText, StringComparison.Ordinal);

        // The follow-up rides the same conversation and completes too.
        assistant.Input = "And the switches?";
        await assistant.SendCommand.ExecuteAsync(null);
        await WaitUntilAsync(() => !assistant.IsStreaming, "the second completion should arrive");
        Assert.Equal(4, assistant.Transcript.Count);

        // Clear: the host stores no conversation, so the delete 404s and the client
        // clears locally anyway - a stuck transcript here means the tolerance broke.
        await assistant.ClearConversationCommand.ExecuteAsync(null);
        Assert.Empty(assistant.Transcript);
        Assert.False(assistant.HasMessages);
    }

    private static async Task WaitUntilAsync(Func<bool> condition, string because)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(20);
        while (!condition())
        {
            Assert.True(DateTime.UtcNow < deadline, $"timed out waiting: {because}");
            await Task.Delay(100, TestContext.Current.CancellationToken);
        }
    }
}
