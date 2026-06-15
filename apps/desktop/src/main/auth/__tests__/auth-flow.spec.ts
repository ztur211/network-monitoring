import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthFlow } from '../auth-flow';

function makeVault() {
  let stored: string | null = null;
  return {
    save: vi.fn(async (t: string) => { stored = t; }),
    load: vi.fn(async () => stored),
    clear: vi.fn(async () => { stored = null; }),
  };
}

describe('AuthFlow', () => {
  let openExternal: ReturnType<typeof vi.fn>;
  let fetchFn: ReturnType<typeof vi.fn>;
  let vault: ReturnType<typeof makeVault>;
  let onChange: ReturnType<typeof vi.fn>;
  let flow: AuthFlow;

  beforeEach(() => {
    openExternal = vi.fn(async () => {});
    fetchFn = vi.fn();
    vault = makeVault();
    onChange = vi.fn();
    flow = new AuthFlow({
      apiUrl: 'https://api.example.com',
      openExternal,
      fetchFn,
      vault,
      onChange,
    });
  });

  it('login opens browser with PKCE challenge, state, and redirect_uri', async () => {
    await flow.login();
    expect(openExternal).toHaveBeenCalledOnce();
    const url = new URL(openExternal.mock.calls[0][0] as string);
    expect(url.origin).toBe('https://api.example.com');
    expect(url.pathname).toBe('/v1/desktop-auth/authorize');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('redirect_uri')).toBe('nodescope://auth/callback');
  });

  it('handleCallback exchanges code on matching state → vault.save → onChange(true)', async () => {
    await flow.login();
    const openedUrl = new URL(openExternal.mock.calls[0][0] as string);
    const state = openedUrl.searchParams.get('state')!;

    fetchFn.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { token: 'ACCESS_TOKEN' } }),
    });

    await flow.handleCallback(`nodescope://auth/callback?code=CODE&state=${state}`);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, opts] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/desktop-auth/token');
    expect(JSON.parse(opts.body as string)).toMatchObject({ code: 'CODE' });
    expect(vault.save).toHaveBeenCalledWith('ACCESS_TOKEN');
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('state-mismatch rejects with AUTH_STATE_MISMATCH', async () => {
    await flow.login();
    await expect(
      flow.handleCallback('nodescope://auth/callback?code=CODE&state=WRONG'),
    ).rejects.toThrow('AUTH_STATE_MISMATCH');
    expect(vault.save).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ignores non-callback deep links', async () => {
    await flow.login();
    await expect(
      flow.handleCallback('nodescope://something/else?foo=bar'),
    ).resolves.toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
