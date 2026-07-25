using System.Text.Json.Serialization;

namespace NodeScope.Desktop.Map;

/// <summary>
/// The map slice of <c>/users/me/preferences</c> - the exact JSON shape the web client
/// wrote (<c>MapPreferences</c> in packages/shared), so preferences keep syncing across
/// clients through the cutover. <c>MapCenter</c> is <c>[longitude, latitude]</c>.
/// </summary>
internal sealed record MapPreferences(
    [property: JsonPropertyName("buildingsVisible")] bool? BuildingsVisible,
    [property: JsonPropertyName("layerToggles")] Dictionary<string, bool>? LayerToggles,
    [property: JsonPropertyName("mapCenter")] double[]? MapCenter,
    [property: JsonPropertyName("mapZoom")] double? MapZoom,
    [property: JsonPropertyName("selectedFloor")] int? SelectedFloor,
    [property: JsonPropertyName("floorDisplayMode")] string? FloorDisplayMode);
