import { runCli } from '../cli';

describe('offsite cli', () => {
  const origEnv = process.env;
  afterEach(() => { process.env = origEnv; });

  it('keygen prints PUBKEY= and PRIVKEY= lines', async () => {
    const out: string[] = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((s) => (out.push(String(s)), true));
    const code = await runCli(['keygen']);
    spy.mockRestore();
    expect(code).toBe(0);
    const text = out.join('');
    expect(text).toMatch(/^PUBKEY=[A-Za-z0-9+/=]+$/m);
    expect(text).toMatch(/^PRIVKEY=[A-Za-z0-9+/=]+$/m);
  });

  it('push errors (non-zero) when off-site is not configured', async () => {
    process.env = { ...origEnv, OFFSITE_BACKUP_PUBKEY: '', OFFSITE_S3_BUCKET: '' };
    const out: string[] = [];
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation((s) => (out.push(String(s)), true));
    const code = await runCli(['push', '/tmp/whatever']);
    spy.mockRestore();
    expect(code).not.toBe(0);
    expect(out.join('')).toMatch(/not configured/);
  });

  it('unknown command returns non-zero', async () => {
    // No/empty OFFSITE env — must still report "unknown command", not "not configured",
    // proving the command is validated before config is required.
    process.env = { ...origEnv, OFFSITE_BACKUP_PUBKEY: '', OFFSITE_S3_BUCKET: '' };
    const out: string[] = [];
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation((s) => (out.push(String(s)), true));
    const code = await runCli(['frobnicate']);
    spy.mockRestore();
    expect(code).not.toBe(0);
    expect(out.join('')).toMatch(/unknown command/);
  });
});
