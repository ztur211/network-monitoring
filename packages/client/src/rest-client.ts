import type { OrganizationDto, PropertyDto, BuildingModelDto } from '@nodescope/shared';
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
      if (!res.ok) throw new ApiError('MODEL_FETCH_FAILED', res.statusText, res.status);
      return res.arrayBuffer();
    },
  };
}
