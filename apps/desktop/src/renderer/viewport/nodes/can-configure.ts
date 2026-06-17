import type { AccessSummaryDto } from '@nodescope/shared';

// The device list is already F3 read-scope-filtered, and an ADMIN's read-scope equals
// their configure-scope (F3 §5), so any LISTED device is configurable by an OWNER/ADMIN —
// a pure role gate suffices. MEMBER is view-only. This is a UX gate only; the PATCH position
// endpoint is the server-side authority (OWNER/ADMIN-gated). NOTE: per-site scope enforcement on
// PATCH position (assertCanConfigure) is a Spec 1 follow-up — see PROGRESS — until then an
// out-of-scope ADMIN is not blocked server-side.
export function canConfigure(access: AccessSummaryDto | null): boolean {
  return access?.role === 'OWNER' || access?.role === 'ADMIN';
}
