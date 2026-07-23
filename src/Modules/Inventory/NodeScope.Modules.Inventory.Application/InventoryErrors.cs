using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Application;

/// <summary>Inventory's module-owned error codes, verbatim from the Node services.</summary>
public static class InventoryErrors
{
    /// <summary>404 <c>PROP_001</c>: property unknown, foreign, or out of scope (indistinguishable).</summary>
    public static ApiException PropertyNotFound() => new("PROP_001", "PROPERTY_NOT_FOUND", 404);

    /// <summary>409 <c>PROP_003</c>: sibling with the same name (case-insensitive).</summary>
    public static ApiException PropertyNameTaken() => new("PROP_003", "PROPERTY_NAME_TAKEN", 409);

    /// <summary>409 <c>PROP_004</c>: delete refused - children, devices, or charters underneath.</summary>
    public static ApiException PropertyNotEmpty() => new("PROP_004", "PROPERTY_NOT_EMPTY", 409);

    /// <summary>422 <c>PROP_005</c>: reparent would create a cycle.</summary>
    public static ApiException PropertyCycle() => new("PROP_005", "PROPERTY_CYCLE", 422);

    /// <summary>409 <c>PROP_006</c>: charter already exists for (network, property).</summary>
    public static ApiException CharterExists() => new("PROP_006", "CHARTER_EXISTS", 409);

    /// <summary>422 <c>PROP_007</c>: device placement outside the network's chartered sites.</summary>
    public static ApiException DeviceNotInCharteredSite() =>
        new("PROP_007", "DEVICE_NOT_IN_CHARTERED_SITE", 422);

    /// <summary>409 <c>PROP_008</c>: charter removal would leave placed devices uncovered.</summary>
    public static ApiException CharterInUse() => new("PROP_008", "CHARTER_IN_USE", 409);

    /// <summary>409 <c>MODEL_008</c>: a BUILDING carrying a model cannot be deleted.</summary>
    public static ApiException BuildingHasModel() => new("MODEL_008", "BUILDING_HAS_MODEL", 409);

    /// <summary>409 <c>PERM_005</c>: a property with team/member assignments cannot be deleted.</summary>
    public static ApiException PropertyAssigned() => new("PERM_005", "PROPERTY_ASSIGNED", 409);

    /// <summary>404 <c>ORG_001</c>: the organization row is missing.</summary>
    public static ApiException OrganizationNotFound() => new("ORG_001", "ORGANIZATION_NOT_FOUND", 404);

    /// <summary>409 <c>ORG_005</c>: device name already used in this org (case-insensitive).</summary>
    public static ApiException DeviceNameTaken() => new("ORG_005", "DEVICE_NAME_TAKEN", 409);

    /// <summary>404 <c>DEVICE_001</c>: device unknown, foreign, or out of scope.</summary>
    public static ApiException DeviceNotFound() => new("DEVICE_001", "DEVICE_NOT_FOUND", 404);

    /// <summary>422 <c>SPATIAL_001</c>: the device does not sit under a modeled BUILDING.</summary>
    public static ApiException DeviceNotInModeledBuilding() =>
        new("SPATIAL_001", "DEVICE_NOT_IN_MODELED_BUILDING", 422);

    /// <summary>422 <c>SPATIAL_002</c>: a partial x/y/z triple.</summary>
    public static ApiException IncompletePosition() => new("SPATIAL_002", "INCOMPLETE_POSITION", 422);

    /// <summary>409 <c>NETWORK_001</c>: the one-network-per-org limit.</summary>
    public static ApiException NetworkLimitExceeded() =>
        new("NETWORK_001", "NETWORK_LIMIT_EXCEEDED", 409);

    /// <summary>404 <c>NETWORK_002</c>: network unknown, foreign, or out of scope.</summary>
    public static ApiException NetworkNotFound() => new("NETWORK_002", "NETWORK_NOT_FOUND", 404);
}
