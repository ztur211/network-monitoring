// BCF (BIM Collaboration Format) shared DTOs — the API↔client contract for
// Spec 6. These shapes are returned by the BCF read/CRUD endpoints and consumed
// by the desktop Issues panel.
//
// Secret-free: viewpoints expose `hasSnapshot` (a presence boolean) rather than
// the internal object-storage `snapshotKey`. The raw storage key is never sent to
// clients — the snapshot is fetched through the export stream / a dedicated route.

// ─── Viewpoint value shapes (mirror the codec's BcfCamera / BcfComponents) ──────

export type BcfCameraKind = 'perspective' | 'orthographic';

export interface BcfCameraDto {
  kind: BcfCameraKind;
  position: [number, number, number];
  direction: [number, number, number];
  up: [number, number, number];
  fieldOfView?: number;
  viewToWorldScale?: number;
}

export interface BcfVisibilityDto {
  defaultVisibility: boolean;
  exceptions: string[];
}

export interface BcfComponentsDto {
  /** Selected element IfcGuids (device links are derived from these). */
  selection: string[];
  visibility: BcfVisibilityDto;
}

export interface BcfViewpointDto {
  id: string;
  guid: string;
  camera: BcfCameraDto;
  components: BcfComponentsDto;
  clippingPlanes: unknown[];
  isPrimary: boolean;
  /** true when a snapshot PNG is stored for this viewpoint (never the storage key). */
  hasSnapshot: boolean;
}

// ─── Comment DTO ───────────────────────────────────────────────────────────────

export interface BcfCommentDto {
  id: string;
  guid: string;
  comment: string;
  author: string;
  date: string;
  viewpointGuid: string | null;
}

// ─── Topic DTOs ────────────────────────────────────────────────────────────────

/** Lightweight topic shape for list endpoints (no nested comments/viewpoints). */
export interface BcfTopicSummaryDto {
  id: string;
  organizationId: string;
  propertyId: string;
  guid: string;
  title: string;
  topicType: string | null;
  topicStatus: string | null;
  priority: string | null;
  labels: string[];
  creationAuthor: string;
  creationDate: string;
  modifiedAuthor: string | null;
  modifiedDate: string | null;
  assignedTo: string | null;
  dueDate: string | null;
  description: string | null;
  version: number;
  /** Number of comments on the topic. */
  commentCount: number;
  /** Linked in-org device ids (derived from viewpoint component IfcGuids). */
  deviceIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** Full topic shape for detail endpoints (with comments + viewpoints). */
export interface BcfTopicDto extends BcfTopicSummaryDto {
  comments: BcfCommentDto[];
  viewpoints: BcfViewpointDto[];
}

// ─── Request DTOs ──────────────────────────────────────────────────────────────

/** A viewpoint supplied when authoring a topic (no id/snapshot yet on the wire). */
export interface CreateBcfViewpointDto {
  guid?: string;
  camera: BcfCameraDto;
  components: BcfComponentsDto;
  clippingPlanes?: unknown[];
  isPrimary?: boolean;
  /** Base64-encoded PNG snapshot, optionally supplied for the primary viewpoint. */
  snapshotPngBase64?: string;
}

export interface CreateBcfTopicDto {
  title: string;
  topicType?: string;
  topicStatus?: string;
  priority?: string;
  labels?: string[];
  assignedTo?: string;
  dueDate?: string;
  description?: string;
  viewpoints?: CreateBcfViewpointDto[];
}

export interface AddBcfCommentDto {
  comment: string;
  /** Optional GUID of an existing viewpoint this comment references. */
  viewpointGuid?: string;
}

export interface PatchBcfTopicDto {
  title?: string;
  topicType?: string | null;
  topicStatus?: string | null;
  priority?: string | null;
  labels?: string[];
  assignedTo?: string | null;
  dueDate?: string | null;
  description?: string | null;
  /** Optimistic-concurrency token: the version the client last read. */
  baseVersion: number;
}
