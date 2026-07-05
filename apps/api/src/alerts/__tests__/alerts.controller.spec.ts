import { AlertsController } from '../alerts.controller';

describe('AlertsController', () => {
  const svc = { createChannel: jest.fn().mockResolvedValue({ id: 'c1' }), listRules: jest.fn().mockResolvedValue([]), testChannel: jest.fn().mockResolvedValue(undefined) } as never;
  const ctrl = new AlertsController(svc);

  it('wraps createChannel in the standard envelope', async () => {
    const res = await ctrl.createChannel('o', { type: 'WEBHOOK', name: 'w', channelIds: [] } as never);
    expect(res).toEqual({ success: true, data: { id: 'c1' }, timestamp: expect.any(String) });
  });
  it('testChannel returns sent:true', async () => {
    expect((await ctrl.testChannel('o', 'c1')).data).toEqual({ sent: true });
  });
});
