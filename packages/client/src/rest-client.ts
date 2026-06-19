import type {
  OrganizationDto,
  PropertyDto,
  BuildingModelDto,
  DeviceDto,
  AccessSummaryDto,
  DeviceStatusDto,
  MetricPointDto,
} from '@nodescope/shared';
import { ApiError } from './api-error';

export interface RestClientOptions {
  baseUrl: string;
  getToken: () => string | null | Promise<string | null>;
}

export function createRestClient(opts: RestClientOptions) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await opts.getToken();
    const res = await fetch(`${opts.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      throw new ApiError(
        json?.error?.code ?? 'UNKNOWN',
        json?.error?.message ?? res.statusText,
        res.status,
      );
    }
    return json.data as T;
  }

  return {
    request,
    getOrganization: () => request<OrganizationDto>('GET', '/v1/organizations/me'),
    listProperties: () => request<PropertyDto[]>('GET', '/v1/properties'),
    getBuildingModel: (propertyId: string) =>
      request<BuildingModelDto>('GET', `/v1/buildings/${propertyId}/model`),
    async getActiveModelFile(propertyId: string): Promise<ArrayBuffer> {
      const token = await opts.getToken();
      const res = await fetch(`${opts.baseUrl}/v1/buildings/${propertyId}/model/active/file`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new ApiError('UNKNOWN', res.statusText, res.status);
      return res.arrayBuffer();
    },
    // Spec 4: the active building's devices (F3 scope-filtered, subtree-resolved server-side).
    listDevicesForBuilding: (buildingPropertyId: string) =>
      request<DeviceDto[]>(
        'GET',
        `/v1/devices?buildingPropertyId=${encodeURIComponent(buildingPropertyId)}`,
      ),
    // Spec 4: place/move (pos) or clear (null) a device's model-local 3D position (Spec 1 endpoint).
    setDevicePosition: (id: string, pos: { x: number; y: number; z: number } | null) =>
      request<DeviceDto>('PATCH', `/v1/devices/${id}/position`, pos ?? { x: null, y: null, z: null }),
    // Spec 4 / F3: the caller's effective access (role + assigned roots) — gates configure affordances (UX only).
    getAccessSummary: () => request<AccessSummaryDto>('GET', '/v1/access/me'),
    // Spec 7: current health status for the building's in-scope devices (Spec 4's initial node-status load).
    getBuildingDeviceStatus: (propertyId: string) =>
      request<DeviceStatusDto[]>(
        'GET',
        `/v1/buildings/${encodeURIComponent(propertyId)}/device-status`,
      ),
    // Spec 7: bucketed metric series for a device (charts).
    getDeviceMetrics: (id: string, metric: string, from: string, to: string, bucket = '5 minutes') =>
      request<MetricPointDto[]>(
        'GET',
        `/v1/devices/${encodeURIComponent(id)}/metrics?metric=${encodeURIComponent(metric)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&bucket=${encodeURIComponent(bucket)}`,
      ),
  };
}
