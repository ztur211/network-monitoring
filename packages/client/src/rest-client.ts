import type {
  OrganizationDto,
  PropertyDto,
  BuildingModelDto,
  BuildingModelVersionDto,
  DeviceDto,
  AccessSummaryDto,
  DeviceStatusDto,
  MetricPointDto,
  BcfTopicDto,
  CreateBcfTopicDto,
  PatchBcfTopicDto,
  AddBcfCommentDto,
} from '@nodescope/shared';
import { ApiError } from './api-error';

export interface RestClientOptions {
  baseUrl: string;
  getToken: () => string | null | Promise<string | null>;
  /** Wall-clock timeout for JSON requests (ms). Default 30s. */
  timeoutMs?: number;
  /** Wall-clock timeout for large binary transfers — model download/upload (ms). Default 120s. */
  transferTimeoutMs?: number;
}

export function createRestClient(opts: RestClientOptions) {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const transferTimeoutMs = opts.transferTimeoutMs ?? 120_000;

  // Abort a request that makes no progress within `ms` and surface it as a recoverable
  // TIMEOUT ApiError. Without this a dead-peer / black-hole connection leaves the awaiting
  // promise pending forever — there is no other app-level timeout in this client.
  async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (controller.signal.aborted) throw new ApiError('TIMEOUT', `Request timed out after ${ms}ms`, 0);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await opts.getToken();
    const res = await fetchWithTimeout(`${opts.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, timeoutMs);
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
      const res = await fetchWithTimeout(`${opts.baseUrl}/v1/buildings/${propertyId}/model/active/file`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }, transferTimeoutMs);
      if (!res.ok) throw new ApiError('UNKNOWN', res.statusText, res.status);
      return res.arrayBuffer();
    },
    // In-app IFC import: upload the raw bytes as a new model version (octet-stream body, NOT
    // multipart — matches the BuildingModelsController upload seam and scripts/load-sample-model.mjs).
    async uploadModelVersion(
      propertyId: string,
      fileName: string,
      bytes: ArrayBuffer,
      units?: string,
    ): Promise<BuildingModelVersionDto> {
      const token = await opts.getToken();
      const qs =
        `fileName=${encodeURIComponent(fileName)}` +
        (units ? `&units=${encodeURIComponent(units)}` : '');
      const res = await fetchWithTimeout(
        `${opts.baseUrl}/v1/buildings/${propertyId}/model/versions?${qs}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: bytes,
        },
        transferTimeoutMs,
      );
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok || json?.success === false) {
        throw new ApiError(
          json?.error?.code ?? 'UNKNOWN',
          json?.error?.message ?? res.statusText,
          res.status,
        );
      }
      return json.data as BuildingModelVersionDto;
    },
    // In-app IFC import: make an uploaded version the live model (drives the realtime reload seam).
    activateModelVersion: (propertyId: string, versionId: string) =>
      request<BuildingModelDto>('PUT', `/v1/buildings/${propertyId}/model/active`, { versionId }),
    // Spec 4: the active building's devices (F3 scope-filtered, subtree-resolved server-side).
    listDevicesForBuilding: (buildingPropertyId: string) =>
      request<DeviceDto[]>(
        'GET',
        `/v1/devices?buildingPropertyId=${encodeURIComponent(buildingPropertyId)}`,
      ),
    // Spec 4: place/move (pos) or clear (null) a device's model-local 3D position (Spec 1 endpoint).
    setDevicePosition: (id: string, pos: { x: number; y: number; z: number } | null) =>
      request<DeviceDto>('PATCH', `/v1/devices/${id}/position`, pos ?? { x: null, y: null, z: null }),
    // Link (or clear with null) the BIM element this device represents, by the element's native IFC
    // GlobalId. The GUID is the only join between the model and network data.
    setDeviceIfcLink: (id: string, ifcGlobalId: string | null) =>
      request<DeviceDto>('PATCH', `/v1/devices/${id}/ifc-link`, { ifcGlobalId }),
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
    // Spec A: metric names seen by a device in the last 24 h (drill-down).
    getDeviceMetricNames: (deviceId: string): Promise<string[]> =>
      request<string[]>('GET', `/v1/devices/${encodeURIComponent(deviceId)}/metric-names`),
    // Spec A: recent status-change events for a device (drill-down timeline).
    getDeviceStatusEvents: (deviceId: string, limit?: number): Promise<{ time: string; state: string; source: string }[]> =>
      request<{ time: string; state: string; source: string }[]>(
        'GET',
        `/v1/devices/${encodeURIComponent(deviceId)}/status-events${limit !== undefined ? `?limit=${encodeURIComponent(limit)}` : ''}`,
      ),
    // Spec 6: BCF topic/comment CRUD
    listBcfTopics: (buildingId: string) =>
      request<BcfTopicDto[]>('GET', `/v1/buildings/${buildingId}/bcf/topics`),
    getBcfTopic: (id: string) =>
      request<BcfTopicDto>('GET', `/v1/bcf/topics/${id}`),
    createBcfTopic: (buildingId: string, dto: CreateBcfTopicDto) =>
      request<BcfTopicDto>('POST', `/v1/buildings/${buildingId}/bcf/topics`, dto),
    patchBcfTopic: (id: string, dto: PatchBcfTopicDto) =>
      request<BcfTopicDto>('PATCH', `/v1/bcf/topics/${id}`, dto),
    addBcfComment: (id: string, dto: AddBcfCommentDto): Promise<void> =>
      request<void>('POST', `/v1/bcf/topics/${id}/comments`, dto),
    exportBcfUrl: (buildingId: string): string =>
      `${opts.baseUrl}/v1/buildings/${buildingId}/bcf/export`,
  };
}
