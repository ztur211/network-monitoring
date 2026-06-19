import { randomBytes } from 'node:crypto';
import { createPkce } from './pkce';

interface AuthFlowDeps {
  apiUrl: string;
  openExternal: (url: string) => Promise<void>;
  fetchFn: typeof fetch;
  vault: { save(t: string): Promise<void>; load(): Promise<string | null>; clear(): Promise<void> };
  onChange: (authed: boolean) => void;
}

export class AuthFlow {
  private pending: { verifier: string; state: string } | null = null;

  constructor(private readonly deps: AuthFlowDeps) {}

  async login(): Promise<void> {
    const { verifier, challenge } = createPkce();
    const state = randomBytes(16).toString('base64url');
    this.pending = { verifier, state };
    const redirect = encodeURIComponent('nodescope://auth/callback');
    await this.deps.openExternal(
      `${this.deps.apiUrl}/v1/desktop-auth/authorize?code_challenge=${challenge}&code_challenge_method=S256&state=${state}&redirect_uri=${redirect}`,
    );
  }

  async handleCallback(rawUrl: string): Promise<void> {
    let u: URL;
    try {
      u = new URL(rawUrl);
    } catch {
      return;
    }
    if (u.protocol !== 'nodescope:' || `${u.host}${u.pathname}` !== 'auth/callback') return;

    const code = u.searchParams.get('code');
    const state = u.searchParams.get('state');
    if (!this.pending || !code || state !== this.pending.state) {
      throw new Error('AUTH_STATE_MISMATCH');
    }

    const res = await this.deps.fetchFn(`${this.deps.apiUrl}/v1/desktop-auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: this.pending.verifier }),
    });
    const json: any = await res.json();
    if (!res.ok || !json?.data?.token) throw new Error('AUTH_EXCHANGE_FAILED');

    await this.deps.vault.save(json.data.token);
    this.pending = null;
    this.deps.onChange(true);
  }

  getToken(): Promise<string | null> {
    return this.deps.vault.load();
  }

  async logout(): Promise<void> {
    await this.deps.vault.clear();
    this.deps.onChange(false);
  }
}
