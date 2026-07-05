import { HttpStatus } from '@nestjs/common';
import { AlertsService } from '../alerts.service';
import type { CreateRuleDto } from '../alerts.dto';

function harness(orgChannels: Array<{ id: string }>) {
  const repo = {
    listChannels: jest.fn().mockResolvedValue(orgChannels),
    createRule: jest.fn().mockImplementation((orgId: string, dto: unknown) =>
      Promise.resolve({ id: 'r1', organizationId: orgId, ...(dto as Record<string, unknown>) }),
    ),
  };
  const dispatcher = { dispatch: jest.fn() };
  return { svc: new AlertsService(repo as never, dispatcher as never), repo };
}

const baseDto = (channelIds: string[]): CreateRuleDto =>
  ({
    name: 'core down',
    trigger: 'STATE_TRANSITION',
    scope: { all: true },
    severity: 'CRITICAL',
    channelIds,
    cooldownSeconds: 60,
    notifyOnRecovery: true,
  }) as CreateRuleDto;

// I4: a rule's channelIds must belong to its own org — otherwise an org could route its alerts
// to another org's webhook/email channel (cross-org alert routing / data leak).
describe('AlertsService.createRule — channel/org validation (I4)', () => {
  it('rejects a channelId that does not belong to the org (400)', async () => {
    const h = harness([{ id: 'c-other-org' }]); // org's channel list does NOT include 'c1'
    await expect(h.svc.createRule('org1', baseDto(['c1']))).rejects.toMatchObject({
      code: 'ALERT_001',
      status: HttpStatus.BAD_REQUEST,
    });
    expect(h.repo.createRule).not.toHaveBeenCalled();
  });

  it('creates the rule when every channelId belongs to the org', async () => {
    const h = harness([{ id: 'c1' }, { id: 'c2' }]);
    const result = await h.svc.createRule('org1', baseDto(['c1']));
    expect(result).toEqual(expect.objectContaining({ id: 'r1' }));
    expect(h.repo.createRule).toHaveBeenCalledTimes(1);
  });

  it('skips the org-channel lookup entirely when channelIds is empty', async () => {
    const h = harness([]);
    await h.svc.createRule('org1', baseDto([]));
    expect(h.repo.listChannels).not.toHaveBeenCalled();
    expect(h.repo.createRule).toHaveBeenCalledTimes(1);
  });
});
