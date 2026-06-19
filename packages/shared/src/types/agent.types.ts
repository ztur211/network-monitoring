/** One OID poll entry in an SNMP target descriptor (decrypted, agent-ready). */
export interface SnmpOidEntry {
  oid: string;
  metric: string;
}

/**
 * Effective SNMP credentials + profile for a device, ready for the agent.
 * Secrets (community, authKey, privKey) are decrypted and present here ONLY.
 * This DTO is never persisted or logged.
 */
export interface SnmpTargetDto {
  version: 'V2C' | 'V3';
  community?: string;
  securityName?: string;
  securityLevel?: string;
  authProtocol?: string;
  authKey?: string;
  privProtocol?: string;
  privKey?: string;
  oids: SnmpOidEntry[];
  interfaceMetrics: boolean;
}

export interface AgentDeviceDto {
  id: string;
  name: string;
  ipAddress: string;
  /** SNMP target descriptor — present only when an effective credential is resolved. */
  snmp?: SnmpTargetDto;
}
export interface AgentEnrollRequest { code: string; name: string; platform: string; version: string; }
export interface AgentEnrollResponse { agentId: string; token: string; }

export interface AgentDto {
  id: string;
  name: string;
  platform: string | null;
  version: string | null;
  status: 'PENDING' | 'APPROVED' | 'REVOKED';
  lastSeenAt: string | null;
}
