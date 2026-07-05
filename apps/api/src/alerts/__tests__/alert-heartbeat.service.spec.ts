import { AlertHeartbeatService } from '../alert-heartbeat.service';

function svc(fetchMock: jest.Mock) {
  const prisma = { deviceStatus: { count: jest.fn().mockResolvedValue(0) } } as never;
  const redis = { set: jest.fn().mockResolvedValue('OK') } as never;
  return new AlertHeartbeatService(prisma, redis, fetchMock as never);
}

describe('AlertHeartbeatService.beatOnce', () => {
  afterEach(() => { delete process.env.ALERT_HEARTBEAT_URL; });

  it('no-ops when ALERT_HEARTBEAT_URL is unset', async () => {
    const f = jest.fn();
    await svc(f).beatOnce();
    expect(f).not.toHaveBeenCalled();
  });
  it('POSTs to the configured URL when set', async () => {
    process.env.ALERT_HEARTBEAT_URL = 'https://hc.test/ping';
    const f = jest.fn().mockResolvedValue({ ok: true });
    await svc(f).beatOnce();
    expect(f).toHaveBeenCalledWith('https://hc.test/ping', expect.objectContaining({ method: 'POST' }));
  });
  it('never throws when the POST fails', async () => {
    process.env.ALERT_HEARTBEAT_URL = 'https://hc.test/ping';
    const f = jest.fn().mockRejectedValue(new Error('down'));
    await expect(svc(f).beatOnce()).resolves.toBeUndefined();
  });
});
