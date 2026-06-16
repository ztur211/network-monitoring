import { safeDesktopReturnTo } from '../safe-desktop-return';

const API_ORIGIN = 'http://localhost:3000';

describe('safeDesktopReturnTo', () => {
  // ── Rejection cases ────────────────────────────────────────────────────────

  it('returns null for null input', () => {
    expect(safeDesktopReturnTo(null, API_ORIGIN)).toBeNull();
  });

  it('returns null for a cross-origin URL (evil.com)', () => {
    expect(safeDesktopReturnTo('https://evil.com', API_ORIGIN)).toBeNull();
  });

  it('returns null for cross-origin with the correct path (right path, wrong origin)', () => {
    expect(
      safeDesktopReturnTo('https://evil.com/api/v1/desktop-auth/authorize', API_ORIGIN),
    ).toBeNull();
  });

  it('returns null for javascript: URI', () => {
    expect(safeDesktopReturnTo('javascript:alert(1)', API_ORIGIN)).toBeNull();
  });

  it('returns null for a protocol-relative URL (//evil.com)', () => {
    // new URL('//evil.com') throws — caught and returns null
    expect(safeDesktopReturnTo('//evil.com', API_ORIGIN)).toBeNull();
  });

  it('returns null for a relative path (rejected — legit value is now absolute)', () => {
    expect(
      safeDesktopReturnTo('/api/v1/desktop-auth/authorize?x=1', API_ORIGIN),
    ).toBeNull();
  });

  it('returns null for same origin but wrong path', () => {
    expect(safeDesktopReturnTo('http://localhost:3000/somewhere-else', API_ORIGIN)).toBeNull();
  });

  // ── Acceptance cases ───────────────────────────────────────────────────────

  it('returns the URL when origin and path both match', () => {
    const url =
      'http://localhost:3000/api/v1/desktop-auth/authorize?code_challenge=c&state=s&redirect_uri=nodescope%3A%2F%2Fauth%2Fcallback';
    expect(safeDesktopReturnTo(url, API_ORIGIN)).toBe(url);
  });
});
