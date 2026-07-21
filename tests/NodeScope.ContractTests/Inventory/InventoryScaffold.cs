namespace NodeScope.ContractTests.Inventory;

/// <summary>
/// Builds the inventory scaffolding a device needs before it can exist. A device is
/// refused with <c>PROP_007</c> unless its target property sits at or under one of
/// its network's chartered sites, so a device test cannot start from a bare
/// <see cref="ContractApiFixture.ProvisionOrgAsync"/> org - it needs a SITE, the
/// org's one network, and a charter binding the two. These helpers assemble exactly
/// that over the same HTTP surface a real operator would, keeping the arrange step
/// honest and out of the individual tests.
/// </summary>
internal static class InventoryScaffold
{
    /// <summary>A site with its network chartered over it, ready to place a device.</summary>
    /// <param name="NetworkId">The org's network, chartered over <paramref name="SiteId"/>.</param>
    /// <param name="SiteId">A top-level SITE property under the network's charter.</param>
    internal sealed record CharteredSite(string NetworkId, string SiteId);

    /// <summary>Creates a property and returns its <c>data</c> element. Top-level when
    /// <paramref name="parentId"/> is null (must then be a SITE, per the nesting rules).</summary>
    public static async Task<JsonElement> CreatePropertyAsync(
        ApiClient api,
        Auth auth,
        string type = "SITE",
        string? name = null,
        string? parentId = null,
        CancellationToken cancellationToken = default)
    {
        name ??= $"prop-{Guid.NewGuid():N}";
        object body = parentId is null
            ? new { type, name }
            : new { type, name, parentId };

        var response = await api.PostAsync("v1/properties", body, auth, cancellationToken);
        Assert.Equal(HttpStatusCode.Created, response.Status);
        return response.Data;
    }

    /// <summary>Creates the org's single network and returns its <c>data</c> element.</summary>
    public static async Task<JsonElement> CreateNetworkAsync(
        ApiClient api,
        Auth auth,
        string? name = null,
        CancellationToken cancellationToken = default)
    {
        name ??= $"net-{Guid.NewGuid():N}";
        var response = await api.PostAsync("v1/networks", new { name }, auth, cancellationToken);
        Assert.Equal(HttpStatusCode.Created, response.Status);
        return response.Data;
    }

    /// <summary>Charters <paramref name="networkId"/> over <paramref name="propertyId"/> so
    /// devices at or under that site can be placed on the network.</summary>
    public static async Task CharterAsync(
        ApiClient api,
        Auth auth,
        string networkId,
        string propertyId,
        CancellationToken cancellationToken = default)
    {
        var response = await api.PostAsync(
            $"v1/networks/{networkId}/properties",
            new { propertyId },
            auth,
            cancellationToken);
        Assert.Equal(HttpStatusCode.Created, response.Status);
    }

    /// <summary>Creates a device on a chartered site and returns its <c>data</c> element.</summary>
    public static async Task<JsonElement> CreateDeviceAsync(
        ApiClient api,
        Auth auth,
        string networkId,
        string propertyId,
        string? name = null,
        string category = "SWITCH",
        CancellationToken cancellationToken = default)
    {
        name ??= $"dev-{Guid.NewGuid():N}";
        var response = await api.PostAsync(
            "v1/devices",
            new { name, category, networkId, propertyId },
            auth,
            cancellationToken);
        Assert.Equal(HttpStatusCode.Created, response.Status);
        return response.Data;
    }

    /// <summary>
    /// Assembles a SITE, the org's network, and a charter binding them - the minimum
    /// state a device needs to exist. The single call the device tests reach for.
    /// </summary>
    public static async Task<CharteredSite> CharteredSiteAsync(
        ApiClient api,
        Auth auth,
        CancellationToken cancellationToken = default)
    {
        var site = await CreatePropertyAsync(api, auth, cancellationToken: cancellationToken);
        var siteId = RequireId(site);
        var network = await CreateNetworkAsync(api, auth, cancellationToken: cancellationToken);
        var networkId = RequireId(network);
        await CharterAsync(api, auth, networkId, siteId, cancellationToken);
        return new CharteredSite(networkId, siteId);
    }

    /// <summary>The <c>id</c> of a captured <c>data</c> element, or a clear failure.</summary>
    public static string RequireId(JsonElement data) =>
        data.GetProperty("id").GetString()
        ?? throw new InvalidOperationException("response data carried no id");
}
