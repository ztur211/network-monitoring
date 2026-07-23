using System.Globalization;

namespace NodeScope.Modules.Inventory.Domain.Onboarding;

/// <summary>The wizard's steps, in the order the happy path walks them.</summary>
public enum OnboardingStepId
{
    Welcome,
    NetworkName,
    Address,
    BrowserDeviceName,
    Mobility,
    ConfirmHomeIp,
    RouterMac,
    ModemMac,
    Isp,
    Speeds,
    Done,
}

/// <summary>Wire labels for <see cref="OnboardingStepId"/> (camelCase, as the client reads them).</summary>
public static class OnboardingStepIds
{
    private static readonly (OnboardingStepId Value, string Label)[] Table =
    [
        (OnboardingStepId.Welcome, "welcome"),
        (OnboardingStepId.NetworkName, "networkName"),
        (OnboardingStepId.Address, "address"),
        (OnboardingStepId.BrowserDeviceName, "browserDeviceName"),
        (OnboardingStepId.Mobility, "mobility"),
        (OnboardingStepId.ConfirmHomeIp, "confirmHomeIp"),
        (OnboardingStepId.RouterMac, "routerMac"),
        (OnboardingStepId.ModemMac, "modemMac"),
        (OnboardingStepId.Isp, "isp"),
        (OnboardingStepId.Speeds, "speeds"),
        (OnboardingStepId.Done, "done"),
    ];

    public static string Of(OnboardingStepId value) =>
        Table.First(entry => entry.Value == value).Label;

    public static OnboardingStepId? TryParse(string? label) =>
        Table.Where(entry => entry.Label == label).Select(entry => (OnboardingStepId?)entry.Value).FirstOrDefault();
}

/// <summary>What the wizard has collected so far. Absent members are omitted from the wire.</summary>
public sealed record OnboardingProgress
{
    public string? NetworkName { get; init; }

    public string? HomeAddress { get; init; }

    public string? BrowserDeviceName { get; init; }

    public string? Mobility { get; init; }

    public string? RouterMac { get; init; }

    public string? ModemMac { get; init; }

    public string? Isp { get; init; }

    public double? DownMbps { get; init; }

    public double? UpMbps { get; init; }
}

/// <summary>A selectable chip in the step's UI.</summary>
public sealed record OnboardingChip(string Label, string Value);

/// <summary>An input field in the step's UI.</summary>
public sealed record OnboardingField(
    string Key,
    string Kind,
    string Label,
    string? Placeholder = null,
    bool? Required = null);

/// <summary>The structural UI of a step; the bot message comes from the narrator.</summary>
public sealed record StepRender(IReadOnlyList<OnboardingChip> Chips, IReadOnlyList<OnboardingField> Fields);

/// <summary>The user's answer to a step.</summary>
public abstract record OnboardingInput;

/// <summary>No answer - the client is asking for the current step (the first turn).</summary>
public sealed record InitInput : OnboardingInput;

/// <summary>The user picked a chip.</summary>
public sealed record ChipInput(string Value) : OnboardingInput;

/// <summary>The user submitted the step's fields.</summary>
public sealed record FieldsInput(IReadOnlyDictionary<string, OnboardingFieldValue> Values) : OnboardingInput;

/// <summary>
/// One submitted field value. The wire admits a string or a number, and the distinction is
/// load-bearing: a text field only accepts a string, while a number field also accepts a
/// numeric string.
/// </summary>
public sealed record OnboardingFieldValue(string? Text, double? Number);

/// <summary>A persistence or lookup action the service must enact after a transition.</summary>
public abstract record OnboardingSideEffect;

/// <summary>Create or update the org's network with whatever the wizard has collected.</summary>
public sealed record SaveNetworkEffect(
    string Name,
    string? HomeAddress = null,
    string? Isp = null,
    double? DownMbps = null,
    double? UpMbps = null) : OnboardingSideEffect;

public sealed record SaveBrowserDeviceEffect(string Name, string Mobility) : OnboardingSideEffect;

public sealed record SaveRouterDeviceEffect(string Name, string? MacAddress) : OnboardingSideEffect;

public sealed record SaveModemDeviceEffect(string Name, string? MacAddress) : OnboardingSideEffect;

/// <summary>Stamp the request's IP as the network's home public IP.</summary>
public sealed record SaveHomeIpEffect : OnboardingSideEffect;

public sealed record GeocodeAddressEffect(string Address) : OnboardingSideEffect;

public sealed record StepResult(
    OnboardingStepId NextStepId,
    OnboardingProgress Progress,
    IReadOnlyList<OnboardingSideEffect> SideEffects,
    bool Complete);

/// <summary>
/// The wizard's pure transition and render logic (Node's <c>onboarding.state-machine.ts</c>):
/// data in, data out, so every path is testable without a database, AI, or network.
/// </summary>
public static class OnboardingStateMachine
{
    private static readonly OnboardingChip SkipChip = new("Skip", "skip");

    private static readonly string[] MobilityValues = ["HOME_ONLY", "ROAMS", "UNKNOWN"];

    /// <summary>The chips and fields the client should display for a step.</summary>
    public static StepRender Render(OnboardingStepId stepId) => stepId switch
    {
        OnboardingStepId.Welcome => new StepRender([new OnboardingChip("Let's go", "start")], []),
        OnboardingStepId.NetworkName => new StepRender(
            [],
            [new OnboardingField("name", "text", "Network name", "Home", true)]),
        OnboardingStepId.Address => new StepRender(
            [SkipChip],
            [new OnboardingField("address", "address", "Home address", Required: false)]),
        OnboardingStepId.BrowserDeviceName => new StepRender(
            [],
            [new OnboardingField("name", "text", "Name this browser", "My Laptop", true)]),
        OnboardingStepId.Mobility => new StepRender(
            [
                new OnboardingChip("Home only", "HOME_ONLY"),
                new OnboardingChip("I take it places", "ROAMS"),
                new OnboardingChip("Not sure", "UNKNOWN"),
            ],
            []),
        OnboardingStepId.ConfirmHomeIp => new StepRender(
            [new OnboardingChip("Yes, this is home", "yes"), new OnboardingChip("No, skip for now", "no")],
            []),
        OnboardingStepId.RouterMac => new StepRender(
            [SkipChip],
            [
                new OnboardingField("name", "text", "Router name", "Main Router", true),
                new OnboardingField("macAddress", "mac", "Router MAC (optional)"),
            ]),
        OnboardingStepId.ModemMac => new StepRender(
            [SkipChip],
            [
                new OnboardingField("name", "text", "Modem name", "Modem", true),
                new OnboardingField("macAddress", "mac", "Modem MAC (optional)"),
            ]),
        OnboardingStepId.Isp => new StepRender(
            [SkipChip],
            [new OnboardingField("isp", "text", "ISP name", "Comcast")]),
        OnboardingStepId.Speeds => new StepRender(
            [SkipChip],
            [
                new OnboardingField("downMbps", "number", "Download Mbps"),
                new OnboardingField("upMbps", "number", "Upload Mbps"),
            ]),
        OnboardingStepId.Done => new StepRender([new OnboardingChip("Close", "close")], []),
        _ => throw new ArgumentOutOfRangeException(nameof(stepId)),
    };

    /// <summary>
    /// Applies the user's input to the current step. An input of the wrong kind (or an empty
    /// required field) leaves the wizard where it is rather than failing the request.
    /// </summary>
    public static StepResult Handle(OnboardingStepId stepId, OnboardingProgress progress, OnboardingInput input)
    {
        ArgumentNullException.ThrowIfNull(progress);
        switch (stepId)
        {
            case OnboardingStepId.Welcome:
                return Advance(progress, OnboardingStepId.NetworkName, []);

            case OnboardingStepId.NetworkName:
            {
                var name = ReadField(input, "name");
                return name is null
                    ? Stay(progress, stepId)
                    : Advance(progress with { NetworkName = name }, OnboardingStepId.Address, []);
            }

            case OnboardingStepId.Address:
            {
                if (IsSkip(input))
                {
                    return Advance(
                        progress,
                        OnboardingStepId.BrowserDeviceName,
                        [new SaveNetworkEffect(progress.NetworkName!)]);
                }

                var address = ReadField(input, "address");
                return address is null
                    ? Stay(progress, stepId)
                    : Advance(
                        progress with { HomeAddress = address },
                        OnboardingStepId.BrowserDeviceName,
                        [
                            new SaveNetworkEffect(progress.NetworkName!, HomeAddress: address),
                            new GeocodeAddressEffect(address),
                        ]);
            }

            case OnboardingStepId.BrowserDeviceName:
            {
                var name = ReadField(input, "name");
                return name is null
                    ? Stay(progress, stepId)
                    : Advance(progress with { BrowserDeviceName = name }, OnboardingStepId.Mobility, []);
            }

            case OnboardingStepId.Mobility:
            {
                if (input is not ChipInput chip || !MobilityValues.Contains(chip.Value, StringComparer.Ordinal))
                {
                    return Stay(progress, stepId);
                }

                return Advance(
                    progress with { Mobility = chip.Value },
                    OnboardingStepId.ConfirmHomeIp,
                    [new SaveBrowserDeviceEffect(progress.BrowserDeviceName!, chip.Value)]);
            }

            case OnboardingStepId.ConfirmHomeIp:
            {
                if (input is not ChipInput confirm)
                {
                    return Stay(progress, stepId);
                }

                return confirm.Value == "yes"
                    ? Advance(progress, OnboardingStepId.RouterMac, [new SaveHomeIpEffect()])
                    : Advance(progress, OnboardingStepId.RouterMac, []);
            }

            case OnboardingStepId.RouterMac:
                return HandleMacDevice(
                    stepId, progress, input, OnboardingStepId.ModemMac,
                    (mac, next) => next with { RouterMac = mac },
                    (name, mac) => new SaveRouterDeviceEffect(name, mac));

            case OnboardingStepId.ModemMac:
                return HandleMacDevice(
                    stepId, progress, input, OnboardingStepId.Isp,
                    (mac, next) => next with { ModemMac = mac },
                    (name, mac) => new SaveModemDeviceEffect(name, mac));

            case OnboardingStepId.Isp:
            {
                if (IsSkip(input))
                {
                    return Advance(progress, OnboardingStepId.Speeds, []);
                }

                var isp = ReadField(input, "isp");
                return isp is null
                    ? Stay(progress, stepId)
                    : Advance(
                        progress with { Isp = isp },
                        OnboardingStepId.Speeds,
                        [new SaveNetworkEffect(progress.NetworkName!, Isp: isp)]);
            }

            case OnboardingStepId.Speeds:
            {
                if (IsSkip(input))
                {
                    return Advance(progress, OnboardingStepId.Done, [], complete: true);
                }

                var downMbps = ReadNumberField(input, "downMbps");
                var upMbps = ReadNumberField(input, "upMbps");
                if (downMbps is null && upMbps is null)
                {
                    return Stay(progress, stepId);
                }

                return Advance(
                    progress with { DownMbps = downMbps, UpMbps = upMbps },
                    OnboardingStepId.Done,
                    [new SaveNetworkEffect(progress.NetworkName!, DownMbps: downMbps, UpMbps: upMbps)],
                    complete: true);
            }

            case OnboardingStepId.Done:
                return new StepResult(OnboardingStepId.Done, progress, [], true);

            default:
                throw new ArgumentOutOfRangeException(nameof(stepId));
        }
    }

    /// <summary>
    /// The router and modem steps differ only in which progress key they record, where they go
    /// next, and which save effect they emit.
    /// </summary>
    private static StepResult HandleMacDevice(
        OnboardingStepId stepId,
        OnboardingProgress progress,
        OnboardingInput input,
        OnboardingStepId nextStepId,
        Func<string?, OnboardingProgress, OnboardingProgress> recordMac,
        Func<string, string?, OnboardingSideEffect> saveEffect)
    {
        if (IsSkip(input))
        {
            return Advance(progress, nextStepId, []);
        }

        var name = ReadField(input, "name");
        if (name is null)
        {
            return Stay(progress, stepId);
        }

        var macAddress = ReadField(input, "macAddress");
        return Advance(recordMac(macAddress, progress), nextStepId, [saveEffect(name, macAddress)]);
    }

    private static StepResult Advance(
        OnboardingProgress progress,
        OnboardingStepId nextStepId,
        IReadOnlyList<OnboardingSideEffect> sideEffects,
        bool complete = false) =>
        new(nextStepId, progress, sideEffects, complete);

    private static StepResult Stay(OnboardingProgress progress, OnboardingStepId stepId) =>
        new(stepId, progress, [], false);

    private static string? ReadField(OnboardingInput input, string key)
    {
        if (input is not FieldsInput fields
            || !fields.Values.TryGetValue(key, out var raw)
            || raw.Text is null)
        {
            return null;
        }

        var trimmed = raw.Text.Trim();
        return trimmed.Length > 0 ? trimmed : null;
    }

    private static double? ReadNumberField(OnboardingInput input, string key)
    {
        if (input is not FieldsInput fields || !fields.Values.TryGetValue(key, out var raw))
        {
            return null;
        }

        if (raw.Number is { } number)
        {
            return double.IsFinite(number) ? number : null;
        }

        return raw.Text is { } text
            && double.TryParse(text.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
            && double.IsFinite(parsed)
                ? parsed
                : null;
    }

    private static bool IsSkip(OnboardingInput input) => input is ChipInput { Value: "skip" };
}
