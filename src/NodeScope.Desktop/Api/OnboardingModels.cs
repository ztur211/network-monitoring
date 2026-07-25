namespace NodeScope.Desktop.Api;

/// <summary>A selectable chip of the current wizard step ("Let's go", "Skip", …).</summary>
internal sealed record OnboardingChip(string Label, string Value);

/// <summary>
/// An input field of the current wizard step. <see cref="Kind"/> is one of the
/// server's field kinds (text / address / mac / number); the distinction is
/// load-bearing for number parsing on submit.
/// </summary>
internal sealed record OnboardingField(
    string Key,
    string Kind,
    string Label,
    string? Placeholder,
    bool? Required);

/// <summary>
/// One turn of <c>POST /api/v1/onboarding/turn</c>: the server-side state machine
/// answers with the next step's narration and UI. The client renders; it decides
/// nothing.
/// </summary>
internal sealed record OnboardingTurn(
    string StepId,
    string BotMessage,
    IReadOnlyList<OnboardingChip> Chips,
    IReadOnlyList<OnboardingField> Fields,
    bool Complete);
