// Stable identity of this browser as a Device row on the server. Persisted in
// localStorage so it survives reloads; generated once on first read.
export const BROWSER_DEVICE_ID_KEY = 'nodescope.browserDeviceId';

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 fallback for environments without crypto.randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getBrowserDeviceId(): string {
  if (typeof localStorage === 'undefined') {
    // No persistence available (e.g. SSR pre-hydration). Return a fresh id so
    // callers can still tag the request; the next browser-side read will
    // generate the real persisted value.
    return generateUuid();
  }
  const existing = localStorage.getItem(BROWSER_DEVICE_ID_KEY);
  if (existing && existing.length > 0) return existing;
  const fresh = generateUuid();
  try {
    localStorage.setItem(BROWSER_DEVICE_ID_KEY, fresh);
  } catch {
    // Storage quota / private mode — proceed with in-memory value.
  }
  return fresh;
}
