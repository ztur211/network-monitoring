/**
 * Unit tests for the browser-device-id helper. The value is the stable
 * identity of this browser as a Device row on the server — it must persist
 * across reloads and never regenerate while the localStorage key is intact.
 */
import { getBrowserDeviceId, BROWSER_DEVICE_ID_KEY } from '../browser-device-id';

class FakeLocalStorage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

describe('getBrowserDeviceId', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      new FakeLocalStorage() as unknown as Storage;
  });

  it('exports the localStorage key as a constant', () => {
    expect(BROWSER_DEVICE_ID_KEY).toBe('nodescope.browserDeviceId');
  });

  it('returns the existing value when one is already stored', () => {
    localStorage.setItem(BROWSER_DEVICE_ID_KEY, 'existing-id-1234');
    expect(getBrowserDeviceId()).toBe('existing-id-1234');
  });

  it('generates and stores a UUID on first read', () => {
    const id = getBrowserDeviceId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(localStorage.getItem(BROWSER_DEVICE_ID_KEY)).toBe(id);
  });

  it('returns the same UUID on subsequent reads', () => {
    const first = getBrowserDeviceId();
    const second = getBrowserDeviceId();
    expect(second).toBe(first);
  });

  it('falls back to a non-empty string when localStorage is unavailable', () => {
    // Simulate localStorage being absent (e.g. SSR pass).
    (globalThis as unknown as { localStorage?: Storage }).localStorage = undefined;
    const id = getBrowserDeviceId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });
});
