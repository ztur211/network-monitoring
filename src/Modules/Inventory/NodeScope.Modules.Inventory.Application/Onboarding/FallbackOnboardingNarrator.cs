using NodeScope.Modules.Inventory.Domain.Onboarding;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Onboarding;

/// <summary>
/// The wizard's fixed copy, verbatim from the Node AI service's onboarding fallback table. It
/// backs every turn until the Assistant module registers a provider-driven narrator, and it is
/// what the Node API itself serves whenever the AI provider is unavailable.
/// </summary>
public sealed class FallbackOnboardingNarrator : IOnboardingNarrator
{
    private static readonly Dictionary<OnboardingStepId, string> Messages = new()
    {
        [OnboardingStepId.Welcome] = "Welcome to NodeScope! Let's get your home network set up.",
        [OnboardingStepId.NetworkName] = "What would you like to call this network?",
        [OnboardingStepId.Address] =
            "What's the address where this network lives? You can skip if you'd rather not say.",
        [OnboardingStepId.BrowserDeviceName] = "Give this browser a name so you can spot it on the map.",
        [OnboardingStepId.Mobility] = "Does this browser ever leave home, or stay on this network?",
        [OnboardingStepId.ConfirmHomeIp] =
            "I can see your current public IP. Use it as the home IP for this network?",
        [OnboardingStepId.RouterMac] = "Have a router MAC handy? Otherwise skip - we'll add it later.",
        [OnboardingStepId.ModemMac] = "Have a modem MAC handy? Otherwise skip - we'll add it later.",
        [OnboardingStepId.Isp] = "Which ISP provides this connection?",
        [OnboardingStepId.Speeds] = "Roughly how fast is the plan, in Mbps?",
        [OnboardingStepId.Done] = "All set! Your home network is on the map.",
    };

    public Task<string> MessageAsync(string stepId, string? userMessage, CancellationToken cancellationToken) =>
        Task.FromResult(
            OnboardingStepIds.TryParse(stepId) is { } step ? Messages[step] : "");
}
