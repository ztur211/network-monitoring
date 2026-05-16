export type AccountTier = 'PERSONAL_FREE' | 'PERSONAL_PAID' | 'MULTI_PROPERTY' | 'ENTERPRISE';

export type ConnectionType = 'ETHERNET' | 'FIBER' | 'WIFI' | 'LOGICAL';

export interface UserDto {
  id: string;
  email: string;
  name: string | null;
  tier: AccountTier;
  homeLatitude: number | null;
  homeLongitude: number | null;
  createdAt: string;
}

export interface DeviceDto {
  id: string;
  userId: string;
  name: string;
  category: string;
  latitude: number | null;
  longitude: number | null;
  floor: number | null;
  floorLabel: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface FiberRunDto {
  id: string;
  userId: string;
  name: string;
  startDeviceId: string;
  endDeviceId: string;
  cableType: string | null;
  lengthMeters: number | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CircuitDto {
  id: string;
  userId: string;
  ispName: string;
  circuitId: string | null;
  serviceType: string;
  bandwidth: number | null;
  deviceId: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceConnectionDto {
  id: string;
  userId: string;
  sourceDeviceId: string;
  targetDeviceId: string;
  connectionType: ConnectionType;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChangesetChangeDto {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface ChangesetDto {
  baseVersion: number;
  changes: ChangesetChangeDto[];
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
}

export interface CursorPaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  timestamp: string;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
}
