using Avalonia.Media;
using NodeScope.Desktop.Api;

namespace NodeScope.Desktop.ViewModels;

internal enum BimInteractionMode
{
    Select,
    PlaceDevice,
    LinkDevice,
}

internal sealed record BimCategoryItem(
    string Name,
    int ProductCount,
    bool IsVisible);

internal sealed record BimFloorOption(string Label, int? Floor);

internal sealed record BimDeviceItem(BimDevice Device, BimDeviceStatus? Monitor)
{
    private static readonly IBrush UpBrush =
        new SolidColorBrush(Color.FromRgb(54, 197, 107));
    private static readonly IBrush DownBrush =
        new SolidColorBrush(Color.FromRgb(230, 71, 78));
    private static readonly IBrush WarningBrush =
        new SolidColorBrush(Color.FromRgb(245, 165, 36));
    private static readonly IBrush UnknownBrush =
        new SolidColorBrush(Color.FromRgb(115, 131, 154));

    public string Id => Device.Id;

    public string Name => Device.Name;

    public string Category => Device.Category;

    public int? Floor => Device.Floor;

    public string FloorCaption => Device.FloorLabel
        ?? (Device.Floor is { } floor ? $"Floor {floor}" : "No floor");

    public bool IsPlaced => Device.IsPlaced;

    public bool IsLinked => Device.IfcGlobalId is not null;

    public string State => Monitor?.State ?? "UNKNOWN";

    public double? LatencyMs => Monitor?.LatencyMs;

    public IBrush StateBrush => State switch
    {
        "UP" => UpBrush,
        "DOWN" => DownBrush,
        "WARNING" => WarningBrush,
        _ => UnknownBrush,
    };

    public string LatencyCaption => LatencyMs is { } latency
        ? $"{latency:0.#} ms"
        : "No latency sample";

    public int Severity => State switch
    {
        "DOWN" => 0,
        "WARNING" => 1,
        "UNKNOWN" => 2,
        _ => 3,
    };
}

internal sealed record BimMetricSeries(
    string Name,
    IReadOnlyList<BimMetricPoint> Points)
{
    public string LatestCaption => Points.Count == 0
        ? "No samples"
        : $"{Points[^1].Avg:0.##}{UnitSuffix}";

    private string UnitSuffix => Name.EndsWith("_ms", StringComparison.OrdinalIgnoreCase)
        ? " ms"
        : Name.EndsWith("_percent", StringComparison.OrdinalIgnoreCase)
            ? "%"
            : string.Empty;
}

internal sealed record BimStatusEventItem(BimStatusEvent Event)
{
    public string State => Event.State;

    public string SourceCaption => string.IsNullOrWhiteSpace(Event.Source)
        ? "Monitor"
        : Event.Source;

    public string TimeCaption => Event.Time
        .ToLocalTime()
        .ToString("MMM d, HH:mm", System.Globalization.CultureInfo.CurrentCulture);
}
