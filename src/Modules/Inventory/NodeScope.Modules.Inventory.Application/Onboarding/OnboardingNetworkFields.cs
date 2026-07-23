using System.Globalization;
using System.Text.Json;
using NodeScope.Modules.Inventory.Application.Networks;

namespace NodeScope.Modules.Inventory.Application.Onboarding;

/// <summary>
/// Turns the wizard's edited <see cref="NetworkRecord"/> into the field payload
/// <see cref="INetworkRepository.UpdateWithVersionAsync"/> expects, keeping only what actually
/// changed so a step never rewrites values a later step already set.
/// </summary>
internal static class OnboardingNetworkFields
{
    public static Dictionary<string, JsonElement> Diff(NetworkRecord before, NetworkRecord after)
    {
        var fields = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        AddIfChanged(fields, "homeAddress", before.HomeAddress, after.HomeAddress);
        AddIfChanged(fields, "homePublicIp", before.HomePublicIp, after.HomePublicIp);
        AddIfChanged(fields, "isp", before.Isp, after.Isp);
        AddIfChanged(fields, "homeLatitude", before.HomeLatitude, after.HomeLatitude);
        AddIfChanged(fields, "homeLongitude", before.HomeLongitude, after.HomeLongitude);
        AddIfChanged(fields, "downMbps", before.DownMbps, after.DownMbps);
        AddIfChanged(fields, "upMbps", before.UpMbps, after.UpMbps);
        return fields;
    }

    private static void AddIfChanged(
        Dictionary<string, JsonElement> fields,
        string name,
        string? before,
        string? after)
    {
        if (before != after && after is not null)
        {
            fields[name] = JsonDocument.Parse(JsonSerializer.Serialize(after)).RootElement.Clone();
        }
    }

    private static void AddIfChanged(
        Dictionary<string, JsonElement> fields,
        string name,
        double? before,
        double? after)
    {
        if (before != after && after is not null)
        {
            fields[name] = JsonDocument
                .Parse(after.Value.ToString("R", CultureInfo.InvariantCulture))
                .RootElement
                .Clone();
        }
    }
}
