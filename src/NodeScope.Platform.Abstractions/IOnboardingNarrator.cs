namespace NodeScope.Platform.Abstractions;

/// <summary>
/// Produces the wizard's bot message for a step. The Assistant module implements it over the
/// AI provider; until then (and whenever the provider is unavailable) the wizard falls back to
/// fixed copy, which is the graceful degradation the Node service already performed - the
/// wizard must keep advancing when the AI is down.
/// </summary>
public interface IOnboardingNarrator
{
    /// <summary>
    /// The message for <paramref name="stepId"/> (the step's wire label), optionally answering
    /// the user's free-text <paramref name="userMessage"/>.
    /// </summary>
    public Task<string> MessageAsync(string stepId, string? userMessage, CancellationToken cancellationToken);
}
