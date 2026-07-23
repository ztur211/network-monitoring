using System.Globalization;
using NodeScope.Modules.Inventory.Application.Properties;
using NodeScope.Modules.Inventory.Domain;

namespace NodeScope.Modules.Inventory.Application.Devices;

/// <summary>
/// Device-name suggestions from the org's naming template (Node's <c>NameSuggestionService</c>).
/// Returns null when the org has no template, when the rendered name is empty, or when every
/// sequence number is taken.
/// </summary>
public sealed class NameSuggestionService
{
    private const int SeqPad = 2;
    private const int SeqMax = 9999;

    private readonly IOrgNamingPolicyReader _orgs;
    private readonly IPropertyRepository _properties;
    private readonly IDeviceRepository _devices;

    public NameSuggestionService(
        IOrgNamingPolicyReader orgs,
        IPropertyRepository properties,
        IDeviceRepository devices)
    {
        _orgs = orgs;
        _properties = properties;
        _devices = devices;
    }

    public async Task<string?> SuggestAsync(
        string organizationId,
        string propertyId,
        DeviceCategory category,
        string? roleCode,
        CancellationToken cancellationToken)
    {
        var policy = await _orgs.FindAsync(organizationId, cancellationToken);
        if (string.IsNullOrEmpty(policy?.NamingTemplate))
        {
            return null;
        }

        var chain = await _properties.AncestorChainAsync(organizationId, propertyId, cancellationToken);
        string CodeOf(PropertyType type) =>
            chain.FirstOrDefault(node => node.Type == type)?.Code ?? "";

        var rendered = NamingTokens.RenderTemplate(
            policy.NamingTemplate,
            new LocationTokens(
                CodeOf(PropertyType.Site),
                CodeOf(PropertyType.Building),
                CodeOf(PropertyType.Floor),
                CodeOf(PropertyType.Area),
                roleCode ?? DeviceCategoryLabels.RoleCodeOf(category)));

        if (!NamingTokens.HasSeqToken(rendered))
        {
            return rendered.Length > 0 ? rendered : null;
        }

        for (var n = 1; n <= SeqMax; n++)
        {
            var candidate = NamingTokens.FillSeq(
                rendered, n.ToString(CultureInfo.InvariantCulture).PadLeft(SeqPad, '0'));
            if (!await _devices.NameExistsAsync(organizationId, candidate, null, cancellationToken))
            {
                return candidate;
            }
        }

        return null;
    }
}
