export interface AgentDeviceDto { id: string; name: string; ipAddress: string; }
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
