namespace NodeScope.Contracts.Realtime;

/// <summary>
/// The realtime event catalogue, verbatim from the Node <c>WS_EVENTS</c> constant. Event
/// names are wire contract shared by the API, the contract suite, and the desktop client.
/// </summary>
public static class WsEvents
{
    // Client -> server
    public const string MetricsSubmit = "v1:metrics:submit";
    public const string AiMessage = "v1:ai:message";
    public const string Ping = "v1:ping";

    // Server -> client
    public const string MetricsUpdate = "v1:metrics:update";
    public const string DeviceUpdated = "v1:device:updated";
    public const string DeviceDeleted = "v1:device:deleted";
    public const string DeviceStatus = "v1:device:status";
    public const string AlertFired = "v1:alert:fired";
    public const string AlertResolved = "v1:alert:resolved";
    public const string CircuitUpdated = "v1:circuit:updated";
    public const string CircuitDeleted = "v1:circuit:deleted";
    public const string FiberRunUpdated = "v1:fiber-run:updated";
    public const string FiberRunDeleted = "v1:fiber-run:deleted";
    public const string ConnectionUpdated = "v1:connection:updated";
    public const string ConnectionDeleted = "v1:connection:deleted";
    public const string AiToken = "v1:ai:token";
    public const string AiComplete = "v1:ai:complete";
    public const string NetworkUpdated = "v1:network:updated";
    public const string NetworkOnHomeChanged = "v1:network:onHome:changed";
    public const string OnboardingTurn = "v1:onboarding:turn";
    public const string Error = "v1:error";
    public const string Pong = "v1:pong";
    public const string OrgUpdated = "v1:org:updated";
    public const string OrgMemberAdded = "v1:org:member:added";
    public const string OrgMemberUpdated = "v1:org:member:updated";
    public const string OrgMemberRemoved = "v1:org:member:removed";
    public const string OrgInvitationCreated = "v1:org:invitation:created";
    public const string OrgInvitationRevoked = "v1:org:invitation:revoked";
    public const string OrgInvitationAccepted = "v1:org:invitation:accepted";
    public const string OrgJoinRequestCreated = "v1:org:joinRequest:created";
    public const string OrgJoinRequestDecided = "v1:org:joinRequest:decided";
    public const string PropertyCreated = "v1:property:created";
    public const string PropertyUpdated = "v1:property:updated";
    public const string PropertyDeleted = "v1:property:deleted";
    public const string PropertyMoved = "v1:property:moved";
    public const string NetworkCharterAdded = "v1:network:charter:added";
    public const string NetworkCharterRemoved = "v1:network:charter:removed";
    public const string TeamCreated = "v1:team:created";
    public const string TeamUpdated = "v1:team:updated";
    public const string TeamDeleted = "v1:team:deleted";
    public const string TeamMemberAdded = "v1:team:member:added";
    public const string TeamMemberRemoved = "v1:team:member:removed";
    public const string TeamPropertyAssigned = "v1:team:property:assigned";
    public const string TeamPropertyUnassigned = "v1:team:property:unassigned";
    public const string MemberPropertyAssigned = "v1:member:property:assigned";
    public const string MemberPropertyUnassigned = "v1:member:property:unassigned";
    public const string AccessChanged = "v1:access:changed";
    public const string BuildingModelVersionUploaded = "v1:buildingModel:versionUploaded";
    public const string BuildingModelActivated = "v1:buildingModel:activated";
    public const string BuildingModelDeleted = "v1:buildingModel:deleted";
    public const string BuildingModelGeoreferenceSet = "v1:buildingModel:georeference";
    public const string BcfTopicCreated = "v1:bcf:topic:created";
    public const string BcfTopicUpdated = "v1:bcf:topic:updated";
    public const string BcfCommentAdded = "v1:bcf:comment:added";
}
