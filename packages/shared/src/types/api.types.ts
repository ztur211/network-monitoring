export type AccountTier = 'PERSONAL_FREE' | 'PERSONAL_PAID' | 'MULTI_PROPERTY' | 'ENTERPRISE';

export interface UserDto {
  id: string;
  email: string;
  name: string | null;
  tier: AccountTier;
  homeLatitude: number | null;
  homeLongitude: number | null;
  createdAt: string;
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
