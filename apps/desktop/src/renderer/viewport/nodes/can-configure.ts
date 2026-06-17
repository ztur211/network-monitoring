import type { AccessSummaryDto } from '@nodescope/shared';

// The device list is already F3 read-scope-filtered, and an ADMIN's read-scope equals
// their configure-scope (F3 §5), so any LISTED device is configurable by an OWNER/ADMIN —
// a pure role gate suffices. MEMBER is view-only. The server is the authority regardless
// (PATCH position runs assertCanConfigure); this only hides affordances.
export function canConfigure(access: AccessSummaryDto | null): boolean {
  return access?.role === 'OWNER' || access?.role === 'ADMIN';
}
