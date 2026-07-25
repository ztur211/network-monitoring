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

    /// <summary>
    /// The smallest byte sequence the model upload accepts: the <c>ISO-10303-21;</c>
    /// magic prefix is the entire validation, so this is a structurally-empty IFC.
    /// </summary>
    public static byte[] MinimalIfcBytes() =>
        System.Text.Encoding.UTF8.GetBytes("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");

    /// <summary>
    /// xBIM's official v4 CubeA fixture (436 bytes). Keeping the tiny binary inline makes
    /// both the API contract and desktop parser tests exercise a real wexBIM file without
    /// checking a third-party binary asset into the product tree.
    /// </summary>
    public static byte[] CubeWexBimBytes() => Convert.FromBase64String(
        "lVecBQQBAAAACAAAAAwAAAAAAAAAAQAAAAUAAAAAAHpEnBKOCYMhxsEbEHToQgzPwQAAAAAAAGnAAQABAAAACGAGRAhgBkQAAPpD"
        + "AAAAAAAAAAAAAAAACGCGRAhghkQAAHpElAAAAP/+/j7//v4+//7+PgAAgD+UAAAA//7+Pv/+/j7//v4+AACAP5QAAAD//v4+"
        + "//7+Pv/+/j4AAIA/lAAAAP/+/j7//v4+//7+PgAAgD+UAAAA//7+Pv/+/j7//v4+AACAP8EAAAAwAgAAAAAAAAAAAAAAAAhg"
        + "hkQIYIZEAAB6RAEAAAABAAAAwQAAADACAAAAAJQAAAC1AAAAAQgAAAAMAAAAwOYLs8I8eUQAAAAAehqcQuDmC7MAAHpEwOYLs8I8"
        + "eUQAAHpEehqcQuDmC7MAAAAACGCGRHoanEIAAHpECGCGRHoanEIAAAAAwjx5RAhghkQAAAAAwjx5RAhghkQAAHpEBgAAAAIAAADB"
        + "hAABAgEAAwIAAAA/9QMEAQQDBQIAAAA/dwQGBwYEBQIAAADCBgcAAgAHBgIAAAB+fgYDAAMGBQIAAAAAfgEHAgcBBA==");

    /// <summary>A SITE with a BUILDING under it - the arrange for model/BCF/export tests.</summary>
    /// <param name="SiteId">The top-level SITE.</param>
    /// <param name="BuildingId">A BUILDING nested under the site.</param>
    internal sealed record SiteWithBuilding(string SiteId, string BuildingId);

    /// <summary>Creates a SITE with a BUILDING under it.</summary>
    public static async Task<SiteWithBuilding> CreateBuildingAsync(
        ApiClient api,
        Auth auth,
        CancellationToken cancellationToken = default)
    {
        var site = await CreatePropertyAsync(api, auth, cancellationToken: cancellationToken);
        var siteId = RequireId(site);
        var building = await CreatePropertyAsync(api, auth, "BUILDING", parentId: siteId, cancellationToken: cancellationToken);
        return new SiteWithBuilding(siteId, RequireId(building));
    }

    /// <summary>
    /// Uploads a model version (raw-body POST, auto-activating) and returns its
    /// <c>data</c> element.
    /// </summary>
    public static async Task<JsonElement> UploadModelVersionAsync(
        ApiClient api,
        Auth auth,
        string buildingId,
        string fileName = "model.ifc",
        byte[]? bytes = null,
        CancellationToken cancellationToken = default)
    {
        var response = await api.PostRawAsync(
            $"v1/buildings/{buildingId}/model/versions?fileName={Uri.EscapeDataString(fileName)}",
            bytes ?? MinimalIfcBytes(),
            auth: auth,
            cancellationToken: cancellationToken);
        Assert.Equal(HttpStatusCode.Created, response.Status);
        return response.Data;
    }
}
