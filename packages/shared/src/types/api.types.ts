// Enums are the source-of-truth Prisma generations re-exported as types.
// Type-only import means the @prisma/client runtime is NOT bundled into the
// web app — Metro tree-shakes the empty import. CLAUDE.md Rule #6 forbids
// hand-written types that duplicate Prisma-generated ones, hence this shape.
import type { AccountTier, ConnectionType, OrgRole, JoinRequestStatus, PropertyType } from '@prisma/client';
export type { AccountTier, ConnectionType, OrgRole, JoinRequestStatus, PropertyType };

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
  userId: string | null;
  networkId: string;
  propertyId: string;
  roleCode: string | null;
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

export interface NetworkPropertyDto {
  id: string;
  networkId: string;
  propertyId: string;
}

export interface FiberRunDto {
  id: string;
  userId: string | null;
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
  userId: string | null;
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
  userId: string | null;
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

export interface OrganizationDto {
  id: string;
  name: string;
  namingPattern: string | null;
  namingMaxLen: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationDomainDto {
  id: string;
  domain: string;
  verified: boolean;
}

export interface OrganizationMemberDto {
  id: string;
  userId: string;
  organizationId: string;
  role: OrgRole;
  createdAt: string;
}

export interface InvitationDto {
  id: string;
  email: string;
  role: OrgRole;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

export interface InvitationLinkDto {
  invitation: InvitationDto;
  token: string;
  url: string;
}

export interface JoinRequestDto {
  id: string;
  organizationId: string;
  userId: string;
  status: JoinRequestStatus;
  createdAt: string;
  decidedAt: string | null;
}

export interface PropertyDto {
  id: string;
  organizationId: string;
  parentId: string | null;
  type: PropertyType;
  name: string;
  code: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type FloorDisplayMode = 'single' | 'all' | 'connection';

export interface MapPreferences {
  buildingsVisible?: boolean;
  layerToggles?: Record<string, boolean>;
  mapCenter?: [number, number];
  mapZoom?: number;
  selectedFloor?: number | null;
  floorDisplayMode?: FloorDisplayMode;
}
