export interface AgentDeviceDto { id: string; name: string; ipAddress: string; }
export interface AgentEnrollRequest { code: string; name: string; platform: string; version: string; }
export interface AgentEnrollResponse { agentId: string; token: string; }
