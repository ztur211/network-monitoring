/**
 * Unit tests for resolveApiBaseUrl — the single source of truth for the web
 * client's API base URL. Vitest runs in a node environment:
 * testEnvironment 'node'), so `window` is undefined unless we set it, which
 * lets us exercise all three resolution branches explicitly.
 */
import { resolveApiBaseUrl } from '../api-base';

describe('resolveApiBaseUrl', () => {
  const ORIGINAL_ENV = process.env.EXPO_PUBLIC_API_URL;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = ORIGINAL_ENV;
    delete (globalThis as { window?: unknown }).window;
  });

  it('prefers the explicit EXPO_PUBLIC_API_URL build-time override', () => {
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.com';
    (globalThis as { window?: unknown }).window = {
      location: { origin: 'http://192.168.1.50:8080' },
    };
    expect(resolveApiBaseUrl()).toBe('https://api.example.com');
  });

  it('falls back to the browser origin when no override is set (LAN appliance)', () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    (globalThis as { window?: unknown }).window = {
      location: { origin: 'http://192.168.1.50:8080' },
    };
    expect(resolveApiBaseUrl()).toBe('http://192.168.1.50:8080');
  });

  it('treats an empty EXPO_PUBLIC_API_URL as unset (same-origin appliance image)', () => {
    process.env.EXPO_PUBLIC_API_URL = '';
    (globalThis as { window?: unknown }).window = {
      location: { origin: 'http://192.168.1.50:8080' },
    };
    expect(resolveApiBaseUrl()).toBe('http://192.168.1.50:8080');
  });

  it('falls back to localhost:3000 with no override and no browser (native/SSR/test)', () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    expect(resolveApiBaseUrl()).toBe('http://localhost:3000');
  });
});
