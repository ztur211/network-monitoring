import { WebhookChannel } from '../channels/webhook.channel';
import { EmailChannel } from '../channels/email.channel';
import { InAppChannel } from '../channels/inapp.channel';
import { ChannelDispatcherImpl } from '../channels/channel-dispatcher.impl';

const evt = { id: 'e1', organizationId: 'o', ruleId: 'r', deviceId: 'd', kind: 'FIRING', severity: 'CRITICAL', detail: { state: 'DOWN' }, dedupKey: 'k', createdAt: new Date() } as never;
const chan = (over = {}) => ({ id: 'c1', organizationId: 'o', type: 'WEBHOOK', name: 'w', enabled: true, config: { url: 'https://hooks.test/x' }, secretEnc: null, ...over }) as never;

describe('WebhookChannel', () => {
  it('POSTs the payload and succeeds on 2xx', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const crypto = { decrypt: (s: string) => s } as never;
    const ch = new WebhookChannel(crypto, fetchMock as never);
    await ch.send(chan(), evt);
    expect(fetchMock).toHaveBeenCalledWith('https://hooks.test/x', expect.objectContaining({ method: 'POST' }));
  });
  it('throws on non-2xx', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    const ch = new WebhookChannel({ decrypt: (s: string) => s } as never, fetchMock as never);
    await expect(ch.send(chan(), evt)).rejects.toThrow(/500/);
  });
  it('adds a bearer header when a secret is set', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const ch = new WebhookChannel({ decrypt: () => 'tok' } as never, fetchMock as never);
    await ch.send(chan({ secretEnc: 'enc' }), evt);
    expect((fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer tok');
  });
});

describe('EmailChannel', () => {
  const emailChan = (over = {}) => chan({ type: 'EMAIL', config: { host: 'smtp.x', port: 587, fromAddr: 'a@x', toAddrs: ['b@x'] }, secretEnc: null, ...over });
  it('sends via SMTP with mapped config and no auth when no secret', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    const make = jest.fn().mockReturnValue({ sendMail });
    await new EmailChannel({ decrypt: () => 'pw' } as never, make as never).send(emailChan(), evt);
    expect(make).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.x', port: 587, auth: undefined }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'a@x', to: 'b@x' }));
  });
  it('uses auth when secret + username are set', async () => {
    const make = jest.fn().mockReturnValue({ sendMail: jest.fn().mockResolvedValue({}) });
    await new EmailChannel({ decrypt: () => 'pw' } as never, make as never)
      .send(emailChan({ config: { host: 'smtp.x', fromAddr: 'a@x', toAddrs: ['b@x'], username: 'u' }, secretEnc: 'enc' }), evt);
    expect(make).toHaveBeenCalledWith(expect.objectContaining({ auth: { user: 'u', pass: 'pw' } }));
  });
  it('throws on misconfig (missing host/from/to)', async () => {
    await expect(new EmailChannel({ decrypt: () => 'pw' } as never, jest.fn() as never).send(emailChan({ config: {} }), evt))
      .rejects.toThrow(/misconfigured/);
  });
});

describe('InAppChannel', () => {
  it('emits the scoped alert event', async () => {
    const emitScoped = jest.fn().mockResolvedValue(undefined);
    const ch = new InAppChannel({ emitScoped } as never);
    await ch.send(chan({ type: 'INAPP', config: { siteId: 's' } }), evt);
    expect(emitScoped).toHaveBeenCalledWith('o', 's', 'v1:alert:fired', expect.any(Object));
  });
});

describe('ChannelDispatcherImpl', () => {
  it('routes by channel type', async () => {
    const webhook = { send: jest.fn().mockResolvedValue(undefined) };
    const email = { send: jest.fn() };
    const inapp = { send: jest.fn() };
    const d = new ChannelDispatcherImpl(webhook as never, email as never, inapp as never);
    await d.dispatch(chan(), evt);
    expect(webhook.send).toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });
});
