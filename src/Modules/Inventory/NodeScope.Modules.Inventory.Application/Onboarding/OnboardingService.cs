using System.Text.Json;
using System.Text.Json.Serialization;
using NodeScope.Contracts.Realtime;
using NodeScope.Modules.Inventory.Application.Networks;
using NodeScope.Modules.Inventory.Domain.Onboarding;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application.Onboarding;

/// <summary>Body of <c>POST /api/v1/onboarding/turn</c>.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class OnboardingTurnRequest
{
    public string? UserMessage { get; init; }

    public string? ChipChoice { get; init; }

    /// <summary>Raw so a string can be told from a number, which the field rules depend on.</summary>
    public IReadOnlyDictionary<string, JsonElement>? FieldValues { get; init; }

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        RequestValidation.MaxLength(errors, UserMessage, "userMessage", 2000);
        RequestValidation.MaxLength(errors, ChipChoice, "chipChoice", 64);
        foreach (var (key, value) in FieldValues ?? new Dictionary<string, JsonElement>())
        {
            if (value.ValueKind == JsonValueKind.String)
            {
                RequestValidation.MaxLength(errors, value.GetString(), $"fieldValues.{key}", 1000);
            }
            else if (value.ValueKind != JsonValueKind.Number)
            {
                errors.Add("fieldValues must be a record of strings or numbers");
            }
        }

        return errors;
    }
}

/// <summary>The turn response the client renders.</summary>
public sealed record OnboardingTurnDto(
    string StepId,
    string BotMessage,
    IReadOnlyList<OnboardingChip> Chips,
    IReadOnlyList<OnboardingField> Fields,
    OnboardingProgress Progress,
    bool Complete);

/// <summary>Where an in-flight wizard's state lives between turns.</summary>
public interface IOnboardingStateStore
{
    public Task<PersistedOnboardingState?> GetAsync(string userId, CancellationToken cancellationToken);

    public Task SetAsync(string userId, PersistedOnboardingState state, CancellationToken cancellationToken);

    public Task ClearAsync(string userId, CancellationToken cancellationToken);

    /// <summary>Records that the user dismissed the wizard (30 days, matching the Node TTL).</summary>
    public Task MarkDismissedAsync(string userId, CancellationToken cancellationToken);
}

public sealed record PersistedOnboardingState(OnboardingStepId StepId, OnboardingProgress Progress);

/// <summary>The durable completion marker (<c>User.onboardingCompletedAt</c>).</summary>
public interface IOnboardingCompletionStore
{
    public Task<bool> IsCompleteAsync(string userId, CancellationToken cancellationToken);

    public Task MarkCompleteAsync(string userId, CancellationToken cancellationToken);
}

/// <summary>Address lookup for the wizard's address step.</summary>
public interface IGeocoder
{
    /// <summary>Coordinates for the address, or null when the lookup fails or finds nothing.</summary>
    public Task<(double Latitude, double Longitude)?> GeocodeAsync(string address, CancellationToken cancellationToken);
}

/// <summary>The onboarding wizard (Node's <c>OnboardingService</c>).</summary>
public sealed class OnboardingService
{
    private readonly IOnboardingStateStore _state;
    private readonly IOnboardingCompletionStore _completion;
    private readonly INetworkRepository _networks;
    private readonly IOnboardingNarrator _narrator;
    private readonly IGeocoder _geocoder;
    private readonly IRealtimeService _realtime;

    public OnboardingService(
        IOnboardingStateStore state,
        IOnboardingCompletionStore completion,
        INetworkRepository networks,
        IOnboardingNarrator narrator,
        IGeocoder geocoder,
        IRealtimeService realtime)
    {
        _state = state;
        _completion = completion;
        _networks = networks;
        _narrator = narrator;
        _geocoder = geocoder;
        _realtime = realtime;
    }

    public async Task<OnboardingTurnDto> TurnAsync(
        string organizationId,
        string userId,
        string requestIp,
        OnboardingTurnRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        // The gate is the durable completion marker, never "the org already has a network": the
        // wizard creates that network mid-flow and keeps editing it. Gating on the network would
        // lock a user out for good once their in-flight state expired. No marker and no state
        // means an abandoned session, which resumes from the top - every side effect is
        // idempotent, so re-walking never duplicates data.
        var persisted = await _state.GetAsync(userId, cancellationToken);
        if (persisted is null && await _completion.IsCompleteAsync(userId, cancellationToken))
        {
            throw InventoryErrors.OnboardingAlreadyComplete();
        }

        var state = persisted ?? new PersistedOnboardingState(OnboardingStepId.Welcome, new OnboardingProgress());
        var result = OnboardingStateMachine.Handle(state.StepId, state.Progress, BuildInput(request));

        foreach (var effect in result.SideEffects)
        {
            await EnactAsync(organizationId, userId, requestIp, effect, cancellationToken);
        }

        var stepId = OnboardingStepIds.Of(result.NextStepId);
        var botMessage = await _narrator.MessageAsync(stepId, request.UserMessage, cancellationToken);
        var render = OnboardingStateMachine.Render(result.NextStepId);

        await _state.SetAsync(userId, new PersistedOnboardingState(result.NextStepId, result.Progress), cancellationToken);
        if (result.Complete)
        {
            await _state.ClearAsync(userId, cancellationToken);
            await _completion.MarkCompleteAsync(userId, cancellationToken);
        }

        await _realtime.PushToOrgAsync(
            organizationId,
            WsEvents.OnboardingTurn,
            new { stepId, complete = result.Complete, timestamp = IsoTimestamp.Now() },
            cancellationToken);

        return new OnboardingTurnDto(
            stepId, botMessage, render.Chips, render.Fields, result.Progress, result.Complete);
    }

    public async Task SkipAsync(string userId, CancellationToken cancellationToken)
    {
        await _state.MarkDismissedAsync(userId, cancellationToken);
        await _state.ClearAsync(userId, cancellationToken);
    }

    private static OnboardingInput BuildInput(OnboardingTurnRequest request)
    {
        if (!string.IsNullOrEmpty(request.ChipChoice))
        {
            return new ChipInput(request.ChipChoice);
        }

        if (request.FieldValues is null)
        {
            return new InitInput();
        }

        return new FieldsInput(
            request.FieldValues.ToDictionary(
                entry => entry.Key,
                entry => new OnboardingFieldValue(
                    entry.Value.ValueKind == JsonValueKind.String ? entry.Value.GetString() : null,
                    entry.Value.ValueKind == JsonValueKind.Number ? entry.Value.GetDouble() : null),
                StringComparer.Ordinal));
    }

    private async Task EnactAsync(
        string organizationId,
        string userId,
        string requestIp,
        OnboardingSideEffect effect,
        CancellationToken cancellationToken)
    {
        switch (effect)
        {
            case SaveNetworkEffect save:
                await UpsertNetworkAsync(
                    organizationId,
                    userId,
                    save.Name,
                    network => network with
                    {
                        HomeAddress = save.HomeAddress ?? network.HomeAddress,
                        Isp = save.Isp ?? network.Isp,
                        DownMbps = save.DownMbps ?? network.DownMbps,
                        UpMbps = save.UpMbps ?? network.UpMbps,
                    },
                    cancellationToken);
                break;

            case SaveHomeIpEffect:
                await UpsertNetworkAsync(
                    organizationId,
                    userId,
                    null,
                    network => network with { HomePublicIp = requestIp },
                    cancellationToken);
                await _realtime.RecomputeOnHomeForUserAsync(userId, cancellationToken);
                break;

            case GeocodeAddressEffect geocode:
            {
                var coordinates = await _geocoder.GeocodeAsync(geocode.Address, cancellationToken);
                if (coordinates is { } found)
                {
                    await UpsertNetworkAsync(
                        organizationId,
                        userId,
                        null,
                        network => network with { HomeLatitude = found.Latitude, HomeLongitude = found.Longitude },
                        cancellationToken);
                }

                break;
            }

            // Browser devices retired with BROWSER_CLIENT, and infrastructure devices need the
            // property context the wizard does not collect yet - both are no-ops in Node too.
            case SaveBrowserDeviceEffect:
            case SaveRouterDeviceEffect:
            case SaveModemDeviceEffect:
                break;

            default:
                throw new ArgumentOutOfRangeException(nameof(effect));
        }
    }

    /// <summary>
    /// Creates the org's network on first use and edits it in place afterwards. The wizard writes
    /// through the repository rather than <see cref="NetworksService"/> on purpose: it is
    /// pre-authorized at the endpoint (OWNER/ADMIN) and is the session's only writer, so the
    /// optimistic-concurrency dance would add nothing. A version miss is logged, not thrown -
    /// that only happens with a duplicate wizard tab, and failing the user's flow is worse.
    /// </summary>
    private async Task UpsertNetworkAsync(
        string organizationId,
        string userId,
        string? name,
        Func<NetworkRecord, NetworkRecord> apply,
        CancellationToken cancellationToken)
    {
        var networks = await _networks.ListVisibleAsync(organizationId, null, cancellationToken);
        var existing = networks.Count > 0 ? networks[0] : null;
        if (existing is null)
        {
            var seed = apply(EmptyNetwork(organizationId, userId, name ?? "Home"));
            await _networks.CreateAsync(
                new NewNetwork(
                    organizationId,
                    userId,
                    seed.Name,
                    seed.HomeAddress,
                    seed.HomeLatitude,
                    seed.HomeLongitude,
                    seed.HomePublicIp,
                    seed.Isp,
                    seed.DownMbps,
                    seed.UpMbps),
                cancellationToken);
            return;
        }

        // The name is set once, at creation: later steps only fill in the other fields.
        var updated = apply(existing);
        var fields = OnboardingNetworkFields.Diff(existing, updated);
        if (fields.Count == 0)
        {
            return;
        }

        // A version miss means a second wizard tab raced this one. The step is dropped rather
        // than thrown through the user's flow; the next step rewrites what it needs.
        await _networks.UpdateWithVersionAsync(
            organizationId, existing.Id, fields, existing.Version, cancellationToken);
    }

    private static NetworkRecord EmptyNetwork(string organizationId, string userId, string name) =>
        new(
            Id: "",
            OrganizationId: organizationId,
            UserId: userId,
            Name: name,
            HomeAddress: null,
            HomeLatitude: null,
            HomeLongitude: null,
            HomePublicIp: null,
            Isp: null,
            DownMbps: null,
            UpMbps: null,
            Version: 1,
            CreatedAt: default,
            UpdatedAt: default);

}
