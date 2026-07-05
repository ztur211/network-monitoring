import axios from 'axios';
import type {
  AgentDto,
  SnmpCredentialDto,
  CreateSnmpCredentialDto,
  OidProfileDto,
  CreateOidProfileDto,
} from '@nodescope/shared';
import { resolveApiBaseUrl } from './api-base';

/** Shape sent to POST /snmp/assign */
export interface AssignSnmpPayload {
  targetType: 'network' | 'device';
  targetId: string;
  snmpCredentialId: string | null;
  oidProfileId: string | null;
}

const apiUrl = resolveApiBaseUrl();

export const api = axios.create({
  baseURL: `${apiUrl}/api/v1`,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      error.response?.data?.error?.code === 'AUTH_002' &&
      typeof window !== 'undefined'
    ) {
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

/** List all agents enrolled in the current org. */
export async function listAgents(): Promise<AgentDto[]> {
  const res = await api.get<{ success: true; data: AgentDto[] }>('/agents');
  return res.data.data;
}

/** Generate a one-time enrollment code for a new agent. */
export async function generateAgentCode(): Promise<{ code: string }> {
  const res = await api.post<{ success: true; data: { code: string } }>(
    '/agents/enrollment-code',
  );
  return res.data.data;
}

/** Revoke an enrolled agent by id. */
export async function revokeAgent(id: string): Promise<void> {
  await api.post(`/agents/${id}/revoke`);
}

// ─── SNMP ────────────────────────────────────────────────────────────────────

/** List SNMP credentials for the current org. Secrets are never returned. */
export async function listSnmpCredentials(): Promise<SnmpCredentialDto[]> {
  const res = await api.get<{ success: true; data: SnmpCredentialDto[] }>('/snmp/credentials');
  return res.data.data;
}

/** Create a new SNMP credential (community/authKey/privKey are write-only). */
export async function createSnmpCredential(
  dto: CreateSnmpCredentialDto,
): Promise<SnmpCredentialDto> {
  const res = await api.post<{ success: true; data: SnmpCredentialDto }>(
    '/snmp/credentials',
    dto,
  );
  return res.data.data;
}

/** Delete an SNMP credential by id. */
export async function deleteSnmpCredential(id: string): Promise<void> {
  await api.delete(`/snmp/credentials/${id}`);
}

/** List OID profiles for the current org. */
export async function listOidProfiles(): Promise<OidProfileDto[]> {
  const res = await api.get<{ success: true; data: OidProfileDto[] }>('/snmp/oid-profiles');
  return res.data.data;
}

/** Create a new OID profile. */
export async function createOidProfile(dto: CreateOidProfileDto): Promise<OidProfileDto> {
  const res = await api.post<{ success: true; data: OidProfileDto }>('/snmp/oid-profiles', dto);
  return res.data.data;
}

/** Assign (or unassign) a credential/profile to a network or device. */
export async function assignSnmp(dto: AssignSnmpPayload): Promise<void> {
  await api.post('/snmp/assign', dto);
}
