// Network DTOs — HTTP-shaped (createdAt/updatedAt as ISO strings, mirroring
// the existing DeviceDto / CircuitDto pattern in api.types.ts).
//
// NetworkSummary vs NetworkDetail: only NetworkDetail exposes homePublicIp.
// List endpoints (GET /networks) return summaries; the IP is only revealed on
// GET /networks/:id under the owning user's session — the plan calls for the
// list to never leak homePublicIp.

export interface NetworkSummary {
  id: string;
  name: string;
  homeAddress: string | null;
  homeLatitude: number | null;
  homeLongitude: number | null;
  isp: string | null;
  downMbps: number | null;
  upMbps: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface NetworkDetail extends NetworkSummary {
  homePublicIp: string | null;
}

export interface CreateNetworkDto {
  name: string;
  homeAddress?: string;
  homeLatitude?: number;
  homeLongitude?: number;
  homePublicIp?: string;
  isp?: string;
  downMbps?: number;
  upMbps?: number;
}

export interface BrowserDeviceInfo {
  browserDeviceId: string;
  name: string;
  mobility: 'HOME_ONLY' | 'ROAMS' | 'UNKNOWN';
  networkId?: string;
}
