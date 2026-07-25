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

    /// <summary>422 <c>BCF_002</c>: a primary viewpoint without a valid PNG snapshot.</summary>
    public static ApiException MissingSnapshotPng() => new("BCF_002", "MISSING_SNAPSHOT_PNG", 422);

    /// <summary>422 <c>BCF_002</c>: a supplied snapshot that is not a PNG.</summary>
    public static ApiException InvalidSnapshot() => new("BCF_002", "INVALID_SNAPSHOT", 422);

    /// <summary>404 <c>BCF_004</c>: topic unknown or belonging to another org.</summary>
    public static ApiException BcfTopicNotFound() => new("BCF_004", "TOPIC_NOT_FOUND", 404);

    /// <summary>409 <c>BCF_005</c>: stale <c>baseVersion</c> on a topic patch.</summary>
    public static ApiException BcfTopicConflict() => new("BCF_005", "TOPIC_VERSION_CONFLICT", 409);

    /// <summary>404 <c>MODEL_001</c>: no model on this building (or the building is invisible).</summary>
    public static ApiException BuildingModelNotFound() => new("MODEL_001", "BUILDING_MODEL_NOT_FOUND", 404);

    /// <summary>422 <c>MODEL_002</c>: models attach to BUILDINGs only.</summary>
    public static ApiException PropertyNotBuilding() => new("MODEL_002", "PROPERTY_NOT_BUILDING", 422);

    /// <summary>404 <c>MODEL_004</c>: version unknown or belonging to another model.</summary>
    public static ApiException ModelVersionNotFound() => new("MODEL_004", "MODEL_VERSION_NOT_FOUND", 404);

    /// <summary>409 <c>MODEL_005</c>: the active version cannot be deleted.</summary>
    public static ApiException CannotDeleteActiveVersion() =>
        new("MODEL_005", "CANNOT_DELETE_ACTIVE_VERSION", 409);

    /// <summary>409 <c>MODEL_008</c>: a BUILDING carrying a model cannot be deleted.</summary>
    public static ApiException BuildingHasModel() => new("MODEL_008", "BUILDING_HAS_MODEL", 409);

    /// <summary>404 <c>MODEL_009</c>: the IFC version has no uploaded render artifact.</summary>
    public static ApiException ModelGeometryNotFound() =>
        new("MODEL_009", "MODEL_GEOMETRY_NOT_FOUND", 404);

    /// <summary>404 <c>MODEL_012</c>: the version predates or lacks its IFC element index.</summary>
    public static ApiException ModelMetadataNotFound() =>
        new("MODEL_012", "MODEL_METADATA_NOT_FOUND", 404);

    /// <summary>422 <c>MODEL_013</c>: malformed or oversized IFC element metadata.</summary>
    public static ApiException InvalidModelMetadata() =>
        new("MODEL_013", "INVALID_MODEL_METADATA", 422);

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

    /// <summary>409 <c>ONBOARD_002</c>: the wizard already finished for this user.</summary>
    public static ApiException OnboardingAlreadyComplete() =>
        new("ONBOARD_002", "ONBOARDING_ALREADY_COMPLETE", 409);

    /// <summary>404 <c>CIRCUIT_001</c>: circuit unknown, foreign, or out of scope.</summary>
    public static ApiException CircuitNotFound() => new("CIRCUIT_001", "CIRCUIT_NOT_FOUND", 404);

    /// <summary>404 <c>FIBER_001</c>: fiber run unknown, foreign, or out of scope.</summary>
    public static ApiException FiberRunNotFound() => new("FIBER_001", "FIBER_RUN_NOT_FOUND", 404);

    /// <summary>422 <c>FIBER_002</c>: both endpoints are the same device.</summary>
    public static ApiException FiberRunSameDevice() => new("FIBER_002", "FIBER_RUN_SAME_DEVICE", 422);

    /// <summary>404 <c>CONN_001</c>: connection unknown, foreign, or out of scope.</summary>
    public static ApiException ConnectionNotFound() => new("CONN_001", "CONNECTION_NOT_FOUND", 404);

    /// <summary>422 <c>CONN_002</c>: a device connected to itself.</summary>
    public static ApiException SelfConnection() => new("CONN_002", "SELF_CONNECTION", 422);

    /// <summary>409 <c>CONN_003</c>: the (source, target, type) triple already exists.</summary>
    public static ApiException DuplicateConnection() => new("CONN_003", "DUPLICATE_CONNECTION", 409);
}
