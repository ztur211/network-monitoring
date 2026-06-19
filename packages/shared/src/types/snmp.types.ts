// SNMP shared DTOs — secrets (community, authKey, privKey) are NEVER exposed on
// read responses. Only presence booleans (hasCommunity / hasAuthKey / hasPrivKey)
// are returned so callers can know whether a secret is configured without
// receiving the plaintext or ciphertext.

export type SnmpVersionDto = 'V2C' | 'V3';
export type SnmpSecurityLevelDto = 'NO_AUTH_NO_PRIV' | 'AUTH_NO_PRIV' | 'AUTH_PRIV';
export type SnmpAuthProtocolDto = 'MD5' | 'SHA' | 'SHA256';
export type SnmpPrivProtocolDto = 'DES' | 'AES' | 'AES256';

// ─── Credential DTOs ──────────────────────────────────────────────────────────

export interface SnmpCredentialDto {
  id: string;
  organizationId: string;
  name: string;
  snmpVersion: SnmpVersionDto;
  securityLevel: SnmpSecurityLevelDto | null;
  securityName: string | null;
  authProtocol: SnmpAuthProtocolDto | null;
  privProtocol: SnmpPrivProtocolDto | null;
  /** true if a community string is stored (v2c). Never the value itself. */
  hasCommunity: boolean;
  /** true if an auth key is stored (v3). Never the value itself. */
  hasAuthKey: boolean;
  /** true if a priv key is stored (v3). Never the value itself. */
  hasPrivKey: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSnmpCredentialDto {
  name: string;
  snmpVersion: SnmpVersionDto;
  securityLevel?: SnmpSecurityLevelDto;
  securityName?: string;
  authProtocol?: SnmpAuthProtocolDto;
  privProtocol?: SnmpPrivProtocolDto;
  /** Plaintext community string (v2c). Encrypted at rest. */
  community?: string;
  /** Plaintext auth key (v3). Encrypted at rest. */
  authKey?: string;
  /** Plaintext priv key (v3). Encrypted at rest. */
  privKey?: string;
}

export interface UpdateSnmpCredentialDto {
  name?: string;
  securityName?: string;
  authProtocol?: SnmpAuthProtocolDto;
  privProtocol?: SnmpPrivProtocolDto;
  community?: string;
  authKey?: string;
  privKey?: string;
}

// ─── OID Profile DTOs ─────────────────────────────────────────────────────────

export interface OidEntryDto {
  id: string;
  oid: string;
  metric: string;
}

export interface OidProfileDto {
  id: string;
  organizationId: string;
  name: string;
  includeInterfaceMetrics: boolean;
  entries: OidEntryDto[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface OidProfileSummaryDto {
  id: string;
  organizationId: string;
  name: string;
  includeInterfaceMetrics: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOidProfileDto {
  name: string;
  includeInterfaceMetrics?: boolean;
  entries?: Array<{ oid: string; metric: string }>;
}

export interface UpdateOidProfileDto {
  name?: string;
  includeInterfaceMetrics?: boolean;
  entries?: Array<{ oid: string; metric: string }>;
}
